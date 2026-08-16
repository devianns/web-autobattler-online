import type { CombatUnit, GridPosition, Team, UnitBaseId, UnitDefinition } from "./types";

export const UNIT_DEFINITIONS = {} as Record<UnitBaseId, UnitDefinition>;

Object.assign(UNIT_DEFINITIONS, {
  U_WARRIOR: { baseId: "U_WARRIOR", name: "전사", role: "근접", cost: 1, color: "#f97316", shape: "square", stats: { maxHp: 650, maxMana: 100, attackDamage: 58, abilityPower: 0, armor: 30, magicResist: 25, attackSpeed: 0.8, range: 1 }, abilityName: "강철 일격", abilityDescription: "공격력 200% 피해" },
  U_ARCHER: { baseId: "U_ARCHER", name: "궁수", role: "원거리", cost: 1, color: "#22c55e", shape: "diamond", stats: { maxHp: 440, maxMana: 0, attackDamage: 66, abilityPower: 0, armor: 15, magicResist: 20, attackSpeed: 1.1, range: 4 }, abilityName: "정밀 사격", abilityDescription: "빠른 원거리 공격" },
  U_KNIGHT: { baseId: "U_KNIGHT", name: "기사", role: "방어", cost: 2, color: "#3b82f6", shape: "hex", stats: { maxHp: 850, maxMana: 120, attackDamage: 44, abilityPower: 0, armor: 48, magicResist: 35, attackSpeed: 0.65, range: 1 }, abilityName: "수호 방패", abilityDescription: "최대 HP 25% 보호막" },
  U_MAGE: { baseId: "U_MAGE", name: "마도사", role: "광역", cost: 2, color: "#a855f7", shape: "circle", stats: { maxHp: 460, maxMana: 90, attackDamage: 38, abilityPower: 105, armor: 15, magicResist: 25, attackSpeed: 0.7, range: 3 }, abilityName: "비전 폭발", abilityDescription: "인접 적 마법 피해" },
  U_ROGUE: { baseId: "U_ROGUE", name: "암살자", role: "기동", cost: 2, color: "#eab308", shape: "diamond", stats: { maxHp: 520, maxMana: 70, attackDamage: 72, abilityPower: 60, armor: 22, magicResist: 22, attackSpeed: 1.2, range: 1 }, abilityName: "그림자 베기", abilityDescription: "최저 HP 적 공격" },
} satisfies Record<UnitBaseId, UnitDefinition>);

export const UNIT_IDS = Object.keys(UNIT_DEFINITIONS) as UnitBaseId[];

export function createCombatUnit(args: { uid: string; baseId: UnitBaseId; team: Team; position: GridPosition; starLevel?: 1 | 2 | 3 }): CombatUnit {
  const definition = UNIT_DEFINITIONS[args.baseId];
  const starLevel = args.starLevel ?? 1;
  const scale = starLevel === 1 ? 1 : starLevel === 2 ? 1.8 : 3.2;
  const stats = { ...definition.stats, maxHp: Math.round(definition.stats.maxHp * scale), attackDamage: Math.round(definition.stats.attackDamage * scale), abilityPower: Math.round(definition.stats.abilityPower * scale) };
  return { uid: args.uid, baseId: args.baseId, name: definition.name, team: args.team, starLevel, position: { ...args.position }, currentHp: stats.maxHp, currentMana: 0, shield: 0, stats, isAlive: true, nextActionAt: 0 };
}
