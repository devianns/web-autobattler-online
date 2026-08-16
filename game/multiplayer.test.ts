import { describe, expect, it } from "vitest";
import { createGame } from "./state";
import { projectCombatForPlayer, simulateMultiplayerRound } from "./multiplayer";
import type { OwnedUnit, UnitBaseId } from "./types";

function player(id: string, baseId: UnitBaseId, starLevel: 1|2|3 = 1) {
  const state=createGame(`player-${id}`);
  const unit:OwnedUnit={uid:`unit-${id}`,baseId,starLevel,location:"BOARD",position:{x:3,y:6},benchSlot:null};
  state.units=[unit]; return {playerId:id,state};
}

describe("multiplayer round simulation",()=>{
  it("produces the same ledger for the same snapshots and seed",()=>{
    const players=[player("a","U_WARRIOR"),player("b","U_ARCHER"),player("c","U_MAGE"),player("d","U_KNIGHT")];
    const first=simulateMultiplayerRound({round:3,seed:"game-round-3",players});
    const second=simulateMultiplayerRound({round:3,seed:"game-round-3",players:[...players].reverse()});
    expect(second).toEqual(first);
    expect(first).toHaveLength(2);
    expect(first.every((entry)=>entry.combat.events.at(-1)?.type==="COMBAT_END")).toBe(true);
  });

  it("never damages a ghost owner through the ghost fight",()=>{
    const ledger=simulateMultiplayerRound({round:5,seed:"odd-round",players:[player("a","U_WARRIOR",3),player("b","U_ARCHER"),player("c","U_MAGE")]});
    const ghost=ledger.find((entry)=>entry.pairing.isGhost)!;
    expect(ghost.damageToB).toBe(0);
    expect(ghost.pairing.playerAId).not.toBe(ghost.pairing.ghostOwnerId);
  });

  it("applies damage only to the loser in a non-ghost decisive fight",()=>{
    const [entry]=simulateMultiplayerRound({round:1,seed:"decisive",players:[player("strong","U_WARRIOR",3),player("weak","U_ARCHER")]});
    expect(entry.combat.winner).not.toBeNull();
    expect([entry.damageToA,entry.damageToB].filter((damage)=>damage>0)).toHaveLength(1);
  });

  it("projects the canonical fight from player B's perspective",()=>{
    const [entry]=simulateMultiplayerRound({round:2,seed:"projection",players:[player("a","U_WARRIOR",2),player("b","U_ARCHER")]});
    const projected=projectCombatForPlayer(entry,entry.pairing.playerBId)!;
    expect(projected.winner).toBe(entry.combat.winner==="PLAYER"?"ENEMY":entry.combat.winner==="ENEMY"?"PLAYER":null);
    const own=projected.initialUnits.find((unit)=>unit.uid.startsWith(`${entry.pairing.playerBId}:`))!;
    expect(own.team).toBe("PLAYER"); expect(own.position.y).toBeGreaterThanOrEqual(4);
    expect(projectCombatForPlayer(entry,"outsider")).toBeNull();
  });
});
