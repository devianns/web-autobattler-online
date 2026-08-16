import { createCombatUnit } from "./content";
import { simulateCombat } from "./engine";
import { playerDamage } from "./state";
import type { CombatResult, OwnedUnit, PrototypeGameState, Team } from "./types";
import { createRoundPairings, type Pairing } from "../matchmaking/pairing";

export interface MultiplayerSnapshot {
  playerId: string;
  state: PrototypeGameState;
}

export interface RoundCombatLedger {
  pairing: Pairing;
  combat: CombatResult;
  damageToA: number;
  damageToB: number;
}

const rotate = (position: {x:number;y:number}) => ({x:7-position.x,y:7-position.y});
const swapTeam = (team:Team):Team => team==="PLAYER"?"ENEMY":"PLAYER";

/** Projects the canonical A-side ledger so either participant always sees
 * their own army as PLAYER on the lower half of the board. */
export function projectCombatForPlayer(entry:RoundCombatLedger,playerId:string):CombatResult|null {
  if(entry.pairing.playerAId===playerId)return structuredClone(entry.combat);
  if(entry.pairing.isGhost||entry.pairing.playerBId!==playerId)return null;
  const combat=structuredClone(entry.combat);
  combat.winner=combat.winner?swapTeam(combat.winner):null;
  combat.initialUnits=combat.initialUnits.map((unit)=>({...unit,team:swapTeam(unit.team),position:rotate(unit.position)}));
  combat.finalUnits=combat.finalUnits.map((unit)=>({...unit,team:swapTeam(unit.team),position:rotate(unit.position)}));
  combat.events=combat.events.map((event)=>event.type==="MOVE"?{...event,from:rotate(event.from),to:rotate(event.to)}:event.type==="COMBAT_END"?{...event,winner:event.winner?swapTeam(event.winner):null}:event);
  return combat;
}

function combatBoard(playerId: string, units: OwnedUnit[], team: Team) {
  return units.filter((unit) => unit.location === "BOARD" && unit.position).map((unit) => createCombatUnit({
    uid: `${playerId}:${unit.uid}`,
    baseId: unit.baseId,
    starLevel: unit.starLevel,
    team,
    position: team === "PLAYER" ? { ...unit.position! } : { x: 7 - unit.position!.x, y: 7 - unit.position!.y },
  }));
}

function survivorWeight(combat: CombatResult, team: Team) {
  return combat.finalUnits.filter((unit) => unit.team === team && unit.isAlive).reduce((sum, unit) => sum + unit.starLevel, 0);
}

export function simulateMultiplayerRound(args: { round: number; seed: string; players: MultiplayerSnapshot[]; previousGhostOwnerId?: string | null }) {
  const byId = new Map(args.players.map((player) => [player.playerId, player]));
  const pairings = createRoundPairings(args.players.map((player) => player.playerId), `${args.seed}:pairings`, args.previousGhostOwnerId ?? null);
  return pairings.map((pairing): RoundCombatLedger => {
    const playerA = byId.get(pairing.playerAId)!;
    const playerB = byId.get(pairing.playerBId)!;
    const combat = simulateCombat({
      seed: `${args.seed}:pair:${pairing.index}`,
      playerUnits: combatBoard(playerA.playerId, playerA.state.units, "PLAYER"),
      enemyUnits: combatBoard(playerB.playerId, playerB.state.units, "ENEMY"),
    });
    const survivorsA = survivorWeight(combat, "PLAYER");
    const survivorsB = survivorWeight(combat, "ENEMY");
    let damageToA = 0; let damageToB = 0;
    if (combat.winner === "PLAYER") damageToB = pairing.isGhost ? 0 : playerDamage(args.round, survivorsA);
    else if (combat.winner === "ENEMY") damageToA = playerDamage(args.round, survivorsB);
    else {
      damageToA = playerDamage(args.round, survivorsB);
      damageToB = pairing.isGhost ? 0 : playerDamage(args.round, survivorsA);
    }
    return { pairing, combat, damageToA, damageToB };
  });
}
