export type Team = "PLAYER" | "ENEMY";
export type UnitBaseId = "U_WARRIOR" | "U_ARCHER" | "U_KNIGHT" | "U_MAGE" | "U_ROGUE";
export interface GridPosition { x: number; y: number }
export interface UnitStats { maxHp: number; maxMana: number; attackDamage: number; abilityPower: number; armor: number; magicResist: number; attackSpeed: number; range: number }
export interface UnitDefinition { baseId: UnitBaseId; name: string; role: string; cost: number; color: string; shape: "square" | "circle" | "diamond" | "hex"; stats: UnitStats; abilityName: string; abilityDescription: string }
export interface CombatUnit { uid: string; baseId: UnitBaseId; name: string; team: Team; starLevel: 1 | 2 | 3; position: GridPosition; currentHp: number; currentMana: number; shield: number; stats: UnitStats; isAlive: boolean; nextActionAt: number }
export type CombatEvent =
  | { seq: number; atMs: number; type: "MOVE"; unitId: string; from: GridPosition; to: GridPosition; durationMs: number }
  | { seq: number; atMs: number; type: "ATTACK_START"; sourceId: string; targetId: string }
  | { seq: number; atMs: number; type: "CAST_START"; sourceId: string; targetIds: string[]; abilityName: string }
  | { seq: number; atMs: number; type: "DAMAGE"; sourceId: string; targetId: string; amount: number; remainingHp: number; absorbed: number }
  | { seq: number; atMs: number; type: "SHIELD"; sourceId: string; targetId: string; amount: number; totalShield: number }
  | { seq: number; atMs: number; type: "MANA_CHANGE"; unitId: string; mana: number }
  | { seq: number; atMs: number; type: "DEATH"; unitId: string }
  | { seq: number; atMs: number; type: "COMBAT_END"; winner: Team | null; reason: CombatEndReason };
export type CombatEndReason = "ELIMINATION" | "TIMEOUT_DRAW" | "DOUBLE_KO_DRAW";
export interface CombatInput { seed: string; playerUnits: CombatUnit[]; enemyUnits: CombatUnit[]; maxDurationMs?: number }
export interface CombatResult { seed: string; winner: Team | null; reason: CombatEndReason; durationMs: number; initialUnits: CombatUnit[]; events: CombatEvent[]; finalUnits: CombatUnit[]; checksum: string }
export interface OwnedUnit { uid: string; baseId: UnitBaseId; starLevel: 1 | 2 | 3; location: "BOARD" | "BENCH"; position: GridPosition | null; benchSlot: number | null }
export interface ShopSlot { slot: number; baseId: UnitBaseId; purchased: boolean }
export type GamePhase = "SHOP" | "COMBAT" | "RESULT" | "GAME_OVER";
export interface PrototypeGameState { version: number; seed: string; phase: GamePhase; round: number; hp: number; enemyHp: number; gold: number; level: number; wins: number; losses: number; units: OwnedUnit[]; shop: ShopSlot[]; combat: CombatResult | null; combatHistory: CombatResult[]; lastResult: string | null }
