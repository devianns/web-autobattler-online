import { describe, expect, it } from "vitest";
import { createRoundPairings } from "./pairing";

describe("createRoundPairings", () => {
  it("is deterministic and assigns every even player exactly once", () => {
    const ids = ["p4", "p2", "p1", "p3"];
    const first = createRoundPairings(ids, "round-1");
    expect(createRoundPairings([...ids].reverse(), "round-1")).toEqual(first);
    expect(first.flatMap((pair) => [pair.playerAId, pair.playerBId]).sort()).toEqual([...ids].sort());
    expect(first.every((pair) => !pair.isGhost)).toBe(true);
  });

  it("creates one ghost fight for an odd survivor and avoids the previous owner", () => {
    const ids = ["p1", "p2", "p3", "p4", "p5"];
    const initial = createRoundPairings(ids, "round-2");
    const ghost = initial.find((pair) => pair.isGhost)!;
    expect(ghost.ghostOwnerId).not.toBe(ghost.playerAId);
    const next = createRoundPairings(ids, "round-2", ghost.ghostOwnerId);
    expect(next.find((pair) => pair.isGhost)?.ghostOwnerId).not.toBe(ghost.ghostOwnerId);
  });

  it("does not create a fight with fewer than two survivors", () => {
    expect(createRoundPairings(["p1"], "round-1")).toEqual([]);
  });
});
