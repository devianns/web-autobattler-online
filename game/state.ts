import { createCombatUnit, UNIT_DEFINITIONS, UNIT_IDS } from "./content";
import { simulateCombat } from "./engine";
import { createRng } from "./rng";
import type { OwnedUnit, PrototypeGameState, ShopSlot, UnitBaseId } from "./types";

export type GameCommand =
  | { type: "BUY"; slot: number }
  | { type: "REROLL" }
  | { type: "MOVE"; uid: string; x: number; y: number }
  | { type: "BENCH"; uid: string }
  | { type: "SELL"; uid: string }
  | { type: "START_COMBAT" }
  | { type: "FINISH_COMBAT" }
  | { type: "NEXT_ROUND" }
  | { type: "RESET" };

export interface CommandResult { state: PrototypeGameState; error: string | null }

function rollShop(seed: string, round: number, version: number): ShopSlot[] {
  const random = createRng(`${seed}:shop:${round}:${version}`);
  return Array.from({ length: 5 }, (_, slot) => ({ slot, baseId: UNIT_IDS[Math.floor(random() * UNIT_IDS.length)], purchased: false }));
}

export function createGame(seed = `game-${Date.now()}`): PrototypeGameState {
  return { version: 1, seed, phase: "SHOP", round: 1, hp: 100, enemyHp: 100, gold: 8, level: 3, wins: 0, losses: 0, units: [], shop: rollShop(seed, 1, 1), combat: null, combatHistory: [], lastResult: "상점에서 유닛을 사고 보드에 배치하세요." };
}

function clone(state: PrototypeGameState): PrototypeGameState { return structuredClone(state) }
function fail(state: PrototypeGameState, error: string): CommandResult { return { state, error } }
function firstBenchSlot(units: OwnedUnit[]) { for (let slot = 0; slot < 9; slot += 1) if (!units.some((unit) => unit.location === "BENCH" && unit.benchSlot === slot)) return slot; return -1 }

function combineUnits(state: PrototypeGameState, baseId: UnitBaseId, starLevel: 1 | 2) {
  const copies = state.units.filter((unit) => unit.baseId === baseId && unit.starLevel === starLevel)
    .sort((a, b) => (a.location === "BOARD" ? -1 : 1) - (b.location === "BOARD" ? -1 : 1) || (a.position?.y ?? 9) - (b.position?.y ?? 9) || (a.position?.x ?? a.benchSlot ?? 9) - (b.position?.x ?? b.benchSlot ?? 9) || a.uid.localeCompare(b.uid));
  if (copies.length < 3) return;
  const keeper = copies[0]; const consumed = new Set(copies.slice(1, 3).map((unit) => unit.uid));
  state.units = state.units.filter((unit) => !consumed.has(unit.uid)).map((unit) => unit.uid === keeper.uid ? { ...unit, starLevel: (starLevel + 1) as 2 | 3 } : unit);
  if (starLevel === 1) combineUnits(state, baseId, 2);
}

function enemyBoard(state: PrototypeGameState) {
  const random = createRng(`${state.seed}:enemy:${state.round}`);
  const count = Math.min(6, 2 + Math.floor(state.round / 2));
  return Array.from({ length: count }, (_, index) => createCombatUnit({
    uid: `enemy-${state.round}-${index}`,
    baseId: UNIT_IDS[Math.floor(random() * UNIT_IDS.length)],
    team: "ENEMY",
    position: { x: 1 + index % 6, y: 1 + Math.floor(index / 6) },
    starLevel: state.round >= 6 && index === 0 ? 2 : 1,
  }));
}

function playerDamage(round: number, survivors: number) { return (round <= 2 ? 2 : round <= 4 ? 3 : round <= 6 ? 4 : 5) + survivors }

export function applyCommand(current: PrototypeGameState, command: GameCommand): CommandResult {
  if (command.type === "RESET") return { state: createGame(), error: null };
  const state = clone(current);
  if (["BUY", "REROLL", "MOVE", "BENCH", "SELL"].includes(command.type) && state.phase !== "SHOP") return fail(current, "상점 단계에서만 조작할 수 있습니다.");

  if (command.type === "BUY") {
    const item = state.shop[command.slot]; if (!item || item.purchased) return fail(current, "구매할 수 없는 상점 칸입니다.");
    const cost = UNIT_DEFINITIONS[item.baseId].cost; if (state.gold < cost) return fail(current, "골드가 부족합니다.");
    const benchSlot = firstBenchSlot(state.units); const completesMerge = state.units.filter((unit) => unit.baseId === item.baseId && unit.starLevel === 1).length >= 2;
    if (benchSlot < 0 && !completesMerge) return fail(current, "벤치가 가득 찼습니다.");
    state.gold -= cost; item.purchased = true;
    state.units.push({ uid: `unit-${state.version}-${command.slot}`, baseId: item.baseId, starLevel: 1, location: "BENCH", position: null, benchSlot: Math.max(0, benchSlot) });
    combineUnits(state, item.baseId, 1); state.version += 1; return { state, error: null };
  }
  if (command.type === "REROLL") {
    if (state.gold < 2) return fail(current, "새로고침에는 2골드가 필요합니다.");
    state.gold -= 2; state.version += 1; state.shop = rollShop(state.seed, state.round, state.version); return { state, error: null };
  }
  if (command.type === "MOVE") {
    if (command.x < 0 || command.x > 7 || command.y < 4 || command.y > 7) return fail(current, "아군 진영 4개 행에만 배치할 수 있습니다.");
    const unit = state.units.find((entry) => entry.uid === command.uid); if (!unit) return fail(current, "유닛을 찾을 수 없습니다.");
    const boardUnits = state.units.filter((entry) => entry.location === "BOARD");
    const occupant = boardUnits.find((entry) => entry.position?.x === command.x && entry.position?.y === command.y);
    if (unit.location !== "BOARD" && boardUnits.length >= state.level && !occupant) return fail(current, `레벨 ${state.level}에서는 ${state.level}개까지만 배치할 수 있습니다.`);
    const oldLocation = unit.location; const oldPosition = unit.position; const oldBench = unit.benchSlot;
    unit.location = "BOARD"; unit.position = { x: command.x, y: command.y }; unit.benchSlot = null;
    if (occupant && occupant.uid !== unit.uid) { occupant.location = oldLocation; occupant.position = oldPosition; occupant.benchSlot = oldBench ?? firstBenchSlot(state.units); }
    state.version += 1; return { state, error: null };
  }
  if (command.type === "BENCH") {
    const unit = state.units.find((entry) => entry.uid === command.uid); if (!unit) return fail(current, "유닛을 찾을 수 없습니다.");
    const slot = firstBenchSlot(state.units); if (slot < 0 && unit.location !== "BENCH") return fail(current, "벤치가 가득 찼습니다.");
    unit.location = "BENCH"; unit.position = null; unit.benchSlot = unit.benchSlot ?? slot; state.version += 1; return { state, error: null };
  }
  if (command.type === "SELL") {
    const unit = state.units.find((entry) => entry.uid === command.uid); if (!unit) return fail(current, "유닛을 찾을 수 없습니다.");
    state.units = state.units.filter((entry) => entry.uid !== command.uid); state.gold += UNIT_DEFINITIONS[unit.baseId].cost * (unit.starLevel === 1 ? 1 : unit.starLevel === 2 ? 3 : 9); state.version += 1; return { state, error: null };
  }
  if (command.type === "START_COMBAT") {
    if (state.phase !== "SHOP") return fail(current, "이미 전투가 시작됐습니다.");
    const board = state.units.filter((unit) => unit.location === "BOARD" && unit.position);
    if (board.length === 0) return fail(current, "보드에 최소 한 유닛을 배치하세요.");
    const playerUnits = board.map((unit) => createCombatUnit({ uid: unit.uid, baseId: unit.baseId, team: "PLAYER", position: unit.position!, starLevel: unit.starLevel }));
    state.combat = simulateCombat({ seed: `${state.seed}:combat:${state.round}`, playerUnits, enemyUnits: enemyBoard(state) });
    state.phase = "COMBAT"; state.version += 1; state.lastResult = null; return { state, error: null };
  }
  if (command.type === "FINISH_COMBAT") {
    if (state.phase !== "COMBAT" || !state.combat) return fail(current, "진행 중인 전투가 없습니다.");
    state.combatHistory ??= [];
    state.combatHistory.push(state.combat);
    const playerSurvivors = state.combat.finalUnits.filter((unit) => unit.isAlive && unit.team === "PLAYER").reduce((sum, unit) => sum + unit.starLevel, 0);
    const enemySurvivors = state.combat.finalUnits.filter((unit) => unit.isAlive && unit.team === "ENEMY").reduce((sum, unit) => sum + unit.starLevel, 0);
    if (state.combat.winner === "PLAYER") { const damage = playerDamage(state.round, playerSurvivors); state.enemyHp = Math.max(0, state.enemyHp - damage); state.wins += 1; state.lastResult = `승리! 상대에게 ${damage} 피해`; }
    else { const damage = playerDamage(state.round, enemySurvivors); state.hp = Math.max(0, state.hp - damage); state.losses += 1; state.lastResult = state.combat.winner === null ? `무승부 · ${damage} 피해` : `패배 · ${damage} 피해`; }
    state.phase = state.hp === 0 || state.enemyHp === 0 ? "GAME_OVER" : "RESULT"; state.version += 1; return { state, error: null };
  }
  if (command.type === "NEXT_ROUND") {
    if (state.phase !== "RESULT") return fail(current, "결과 단계가 아닙니다.");
    state.round += 1; state.gold += 5 + Math.min(5, Math.floor(state.gold / 10)); state.phase = "SHOP"; state.combat = null; state.version += 1; state.shop = rollShop(state.seed, state.round, state.version); return { state, error: null };
  }
  return fail(current, "알 수 없는 명령입니다.");
}
