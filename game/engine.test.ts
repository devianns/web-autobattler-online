import { describe, expect, it } from "vitest";
import { createCombatUnit } from "./content";
import { simulateCombat } from "./engine";

const fixture = () => ({ seed: "fixture", playerUnits: [createCombatUnit({ uid: "p1", baseId: "U_WARRIOR", team: "PLAYER" as const, position: { x: 2, y: 6 } }), createCombatUnit({ uid: "p2", baseId: "U_ARCHER", team: "PLAYER" as const, position: { x: 1, y: 7 } })], enemyUnits: [createCombatUnit({ uid: "e1", baseId: "U_KNIGHT", team: "ENEMY" as const, position: { x: 5, y: 1 } }), createCombatUnit({ uid: "e2", baseId: "U_MAGE", team: "ENEMY" as const, position: { x: 6, y: 0 } })] });

describe("combat engine", () => {
  it("is deterministic", () => { const first = simulateCombat(fixture()); const second = simulateCombat(fixture()); expect(second.checksum).toBe(first.checksum); expect(second.events).toEqual(first.events) });
  it("ends with ordered events and valid hp", () => { const result = simulateCombat(fixture()); expect(result.events.at(-1)?.type).toBe("COMBAT_END"); expect(result.events.every((event, index) => event.seq === index + 1)).toBe(true); expect(result.finalUnits.every((unit) => unit.currentHp >= 0)).toBe(true) });
});
