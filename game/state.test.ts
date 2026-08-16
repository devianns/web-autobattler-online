import { describe, expect, it } from "vitest";
import { applyCommand, createGame } from "./state";

describe("prototype game state", () => {
  it("supports buying, deploying, combat and result", () => {
    let game = createGame("state-flow");
    game = applyCommand(game, { type: "BUY", slot: 0 }).state;
    const unit = game.units[0];
    expect(unit.location).toBe("BENCH");
    game = applyCommand(game, { type: "MOVE", uid: unit.uid, x: 3, y: 6 }).state;
    expect(game.units[0].location).toBe("BOARD");
    game = applyCommand(game, { type: "START_COMBAT" }).state;
    expect(game.phase).toBe("COMBAT");
    expect(game.combat?.events.at(-1)?.type).toBe("COMBAT_END");
    game = applyCommand(game, { type: "FINISH_COMBAT" }).state;
    expect(["RESULT", "GAME_OVER"]).toContain(game.phase);
  });

  it("rejects deploying outside the player zone", () => {
    let game = createGame("invalid-move");
    game = applyCommand(game, { type: "BUY", slot: 0 }).state;
    const result = applyCommand(game, { type: "MOVE", uid: game.units[0].uid, x: 2, y: 2 });
    expect(result.error).toContain("아군 진영");
    expect(result.state.version).toBe(game.version);
  });
});
