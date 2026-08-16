import { UNIT_DEFINITIONS } from "./content";
import { hashString } from "./rng";
import type { CombatEvent, CombatInput, CombatResult, CombatUnit, GridPosition, Team } from "./types";

const TICK_MS = 100;
const distance = (a: GridPosition, b: GridPosition) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const physical = (value: number, armor: number) => Math.max(1, Math.round(value * 100 / (100 + Math.max(-50, armor))));
const magic = (value: number, resist: number) => Math.max(1, Math.round(value * 100 / (100 + Math.max(-50, resist))));
type EventWithoutSeq = CombatEvent extends infer Event ? Event extends CombatEvent ? Omit<Event, "seq"> : never : never;

function targetFor(source: CombatUnit, units: CombatUnit[]) {
  return units.filter((unit) => unit.isAlive && unit.team !== source.team).sort((a, b) =>
    distance(source.position, a.position) - distance(source.position, b.position) || a.currentHp - b.currentHp || a.position.y - b.position.y || a.position.x - b.position.x || a.uid.localeCompare(b.uid))[0];
}

function nextStep(source: CombatUnit, target: CombatUnit, units: CombatUnit[]) {
  const occupied = new Set(units.filter((unit) => unit.isAlive && unit.uid !== source.uid).map((unit) => `${unit.position.x}:${unit.position.y}`));
  const candidates: GridPosition[] = [];
  for (let y = -1; y <= 1; y += 1) for (let x = -1; x <= 1; x += 1) {
    if (x === 0 && y === 0) continue;
    const point = { x: source.position.x + x, y: source.position.y + y };
    if (point.x >= 0 && point.x <= 7 && point.y >= 0 && point.y <= 7 && !occupied.has(`${point.x}:${point.y}`)) candidates.push(point);
  }
  return candidates.sort((a, b) => distance(a, target.position) - distance(b, target.position) || a.y - b.y || a.x - b.x)[0] ?? null;
}

export function simulateCombat(input: CombatInput): CombatResult {
  const maxDurationMs = input.maxDurationMs ?? 40_000;
  const units = [...input.playerUnits, ...input.enemyUnits].map((unit) => ({ ...unit, position: { ...unit.position }, stats: { ...unit.stats } }));
  const initialUnits = structuredClone(units);
  const events: CombatEvent[] = [];
  let sequence = 0;
  const emit = (event: EventWithoutSeq) => events.push({ ...event, seq: ++sequence } as CombatEvent);

  const dealDamage = (atMs: number, source: CombatUnit, target: CombatUnit, amount: number) => {
    const absorbed = Math.min(target.shield, amount);
    target.shield -= absorbed;
    const hpDamage = amount - absorbed;
    target.currentHp = Math.max(0, target.currentHp - hpDamage);
    if (target.stats.maxMana > 0 && hpDamage > 0) target.currentMana = Math.min(target.stats.maxMana, target.currentMana + Math.max(1, Math.round(hpDamage / target.stats.maxHp * 50)));
    emit({ atMs, type: "DAMAGE", sourceId: source.uid, targetId: target.uid, amount, remainingHp: target.currentHp, absorbed });
    if (target.currentHp === 0 && target.isAlive) { target.isAlive = false; emit({ atMs, type: "DEATH", unitId: target.uid }); }
  };

  const cast = (atMs: number, source: CombatUnit, primary: CombatUnit) => {
    source.currentMana = 0;
    const abilityName = UNIT_DEFINITIONS[source.baseId].abilityName;
    if (source.baseId === "U_KNIGHT") {
      const amount = Math.round(source.stats.maxHp * 0.25); source.shield += amount;
      emit({ atMs, type: "CAST_START", sourceId: source.uid, targetIds: [source.uid], abilityName });
      emit({ atMs, type: "SHIELD", sourceId: source.uid, targetId: source.uid, amount, totalShield: source.shield }); return;
    }
    let targets = [primary];
    if (source.baseId === "U_MAGE") targets = units.filter((unit) => unit.isAlive && unit.team !== source.team && distance(unit.position, primary.position) <= 1);
    if (source.baseId === "U_ROGUE") targets = units.filter((unit) => unit.isAlive && unit.team !== source.team).sort((a, b) => a.currentHp - b.currentHp || a.uid.localeCompare(b.uid)).slice(0, 1);
    emit({ atMs, type: "CAST_START", sourceId: source.uid, targetIds: targets.map((unit) => unit.uid), abilityName });
    for (const target of targets) {
      const raw = source.baseId === "U_WARRIOR" ? source.stats.attackDamage * 2 : source.stats.abilityPower;
      dealDamage(atMs, source, target, source.baseId === "U_WARRIOR" ? physical(raw, target.stats.armor) : magic(raw, target.stats.magicResist));
    }
  };

  let winner: Team | null = null; let reason: CombatResult["reason"] = "TIMEOUT_DRAW"; let durationMs = maxDurationMs;
  for (let atMs = 0; atMs <= maxDurationMs; atMs += TICK_MS) {
    const playerAlive = units.some((unit) => unit.isAlive && unit.team === "PLAYER");
    const enemyAlive = units.some((unit) => unit.isAlive && unit.team === "ENEMY");
    if (!playerAlive || !enemyAlive) { durationMs = atMs; winner = playerAlive === enemyAlive ? null : playerAlive ? "PLAYER" : "ENEMY"; reason = playerAlive === enemyAlive ? "DOUBLE_KO_DRAW" : "ELIMINATION"; break; }
    const actors = units.filter((unit) => unit.isAlive && unit.nextActionAt <= atMs).sort((a, b) => a.team.localeCompare(b.team) || a.position.y - b.position.y || a.position.x - b.position.x || a.uid.localeCompare(b.uid));
    for (const source of actors) {
      if (!source.isAlive) continue; const target = targetFor(source, units); if (!target) continue;
      if (distance(source.position, target.position) > source.stats.range) {
        const step = nextStep(source, target, units); if (step) { const from = { ...source.position }; source.position = step; source.nextActionAt = atMs + 300; emit({ atMs, type: "MOVE", unitId: source.uid, from, to: { ...step }, durationMs: 260 }); } else source.nextActionAt = atMs + TICK_MS; continue;
      }
      if (source.stats.maxMana > 0 && source.currentMana >= source.stats.maxMana) cast(atMs, source, target);
      else { emit({ atMs, type: "ATTACK_START", sourceId: source.uid, targetId: target.uid }); dealDamage(atMs + 100, source, target, physical(source.stats.attackDamage, target.stats.armor)); if (source.stats.maxMana > 0) { source.currentMana = Math.min(source.stats.maxMana, source.currentMana + 10); emit({ atMs: atMs + 100, type: "MANA_CHANGE", unitId: source.uid, mana: source.currentMana }); } }
      source.nextActionAt = atMs + Math.max(TICK_MS, Math.floor(1000 / source.stats.attackSpeed / TICK_MS) * TICK_MS);
    }
  }
  emit({ atMs: durationMs, type: "COMBAT_END", winner, reason });
  events.sort((a, b) => a.atMs - b.atMs || a.seq - b.seq).forEach((event, index) => { event.seq = index + 1; });
  const checksum = hashString(JSON.stringify({ seed: input.seed, winner, reason, durationMs, events, units })).toString(16).padStart(8, "0");
  return { seed: input.seed, winner, reason, durationMs, initialUnits, events, finalUnits: units, checksum };
}
