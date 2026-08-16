import "server-only";
import { createGame } from "@/game/state";
import type { PrototypeGameState } from "@/game/types";
import { projectCombatForPlayer, type RoundCombatLedger } from "@/game/multiplayer";
import { ensureLobbySchema } from "./lobby-store";
import { sql } from "./database";

let onlineSchemaReady: Promise<void> | null = null;
export async function ensureOnlineSchema() {
  await ensureLobbySchema();
  onlineSchemaReady ??= (async () => {
    await sql`ALTER TABLE online_game_players ADD COLUMN IF NOT EXISTS state jsonb`;
    await sql`CREATE TABLE IF NOT EXISTS online_game_actions (
      game_id uuid NOT NULL REFERENCES online_games(id) ON DELETE CASCADE,
      session_id uuid NOT NULL REFERENCES anonymous_sessions(id),
      action_id uuid NOT NULL,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (game_id, session_id, action_id)
    )`;
    await sql`CREATE INDEX IF NOT EXISTS online_game_actions_player_idx ON online_game_actions(game_id, session_id, created_at DESC)`;
  })();
  return onlineSchemaReady;
}

export async function loadOnlineGame(gameId: string, sessionId: string) {
  await ensureOnlineSchema();
  const rows = await sql`SELECT p.state,g.seed,p.seat FROM online_game_players p JOIN online_games g ON g.id=p.game_id WHERE p.game_id=${gameId}::uuid AND p.session_id=${sessionId}::uuid`;
  if (!rows[0]) return null;
  if (rows[0].state && Object.keys(rows[0].state).length > 0) return rows[0].state as PrototypeGameState;
  const initial = createGame(`${rows[0].seed}:player:${rows[0].seat}`);
  const initialized = await sql`UPDATE online_game_players SET state=${JSON.stringify(initial)}::jsonb,state_version=${initial.version} WHERE game_id=${gameId}::uuid AND session_id=${sessionId}::uuid AND state IS NULL RETURNING state`;
  if (initialized[0]) return initialized[0].state as PrototypeGameState;
  const latest = await sql`SELECT state FROM online_game_players WHERE game_id=${gameId}::uuid AND session_id=${sessionId}::uuid`;
  return latest[0]?.state as PrototypeGameState | null;
}

export async function loadOnlineGameView(gameId:string,sessionId:string){
  const state=await loadOnlineGame(gameId,sessionId); if(!state)return null;
  const games=await sql`SELECT phase,round,phase_version,phase_ends_at FROM online_games WHERE id=${gameId}::uuid`;
  if(!games[0])return null; const game=games[0];
  const playerRows=await sql`SELECT session_id::text,nickname_snapshot,seat,hp,wins,losses,eliminated_at FROM online_game_players WHERE game_id=${gameId}::uuid ORDER BY eliminated_at NULLS FIRST,hp DESC,seat`;
  let combat=null; let opponentSessionId:string|null=null; let isGhost=false;
  if(game.phase==="COMBAT"||game.phase==="RESULT"){
    const rows=await sql`SELECT result,player_a_id::text,player_b_id::text,is_ghost FROM online_game_pairings WHERE game_id=${gameId}::uuid AND round=${game.round} AND (player_a_id=${sessionId}::uuid OR (NOT is_ghost AND player_b_id=${sessionId}::uuid)) ORDER BY is_ghost ASC,pairing_index LIMIT 1`;
    if(rows[0]?.result){combat=projectCombatForPlayer(rows[0].result as RoundCombatLedger,sessionId);opponentSessionId=rows[0].player_a_id===sessionId?rows[0].player_b_id:rows[0].player_a_id;isGhost=rows[0].is_ghost}
  }
  const visiblePhase=state.hp<=0&&game.phase!=="GAME_OVER"?"RESULT":game.phase;
  const projected={...state,round:game.round,phase:visiblePhase,combat,combatHistory:state.combatHistory??[]} as PrototypeGameState;
  return {state:projected,game:{phase:game.phase as PrototypeGameState["phase"],round:game.round,phaseVersion:game.phase_version,phaseEndsAt:game.phase_ends_at as string,opponentSessionId,isGhost,players:playerRows.map((row)=>({sessionId:row.session_id,nickname:row.nickname_snapshot,seat:row.seat,hp:row.hp,wins:row.wins,losses:row.losses,eliminated:row.eliminated_at!==null}))}};
}

export async function loadOnlineAction(gameId: string, sessionId: string, actionId: string) {
  await ensureOnlineSchema();
  const rows = await sql`SELECT response FROM online_game_actions WHERE game_id=${gameId}::uuid AND session_id=${sessionId}::uuid AND action_id=${actionId}::uuid`;
  return rows[0]?.response as PrototypeGameState | undefined;
}

export async function saveOnlineCommand(args: { gameId: string; sessionId: string; actionId: string; expectedVersion: number; state: PrototypeGameState }) {
  await ensureOnlineSchema();
  const rows = await sql`WITH duplicate AS (
      SELECT response FROM online_game_actions WHERE game_id=${args.gameId}::uuid AND session_id=${args.sessionId}::uuid AND action_id=${args.actionId}::uuid
    ), updated AS (
      UPDATE online_game_players SET state=${JSON.stringify(args.state)}::jsonb,state_version=${args.state.version}
      WHERE game_id=${args.gameId}::uuid AND session_id=${args.sessionId}::uuid AND state_version=${args.expectedVersion} AND NOT EXISTS (SELECT 1 FROM duplicate)
      RETURNING state
    ), recorded AS (
      INSERT INTO online_game_actions (game_id,session_id,action_id,response)
      SELECT ${args.gameId}::uuid,${args.sessionId}::uuid,${args.actionId}::uuid,state FROM updated
      ON CONFLICT (game_id,session_id,action_id) DO NOTHING RETURNING response
    )
    SELECT response,'APPLIED' status FROM recorded
    UNION ALL SELECT response,'DUPLICATE' status FROM duplicate LIMIT 1`;
  if (rows[0]) return { status: rows[0].status as "APPLIED" | "DUPLICATE", state: rows[0].response as PrototypeGameState };
  return { status: "CONFLICT" as const, state: await loadOnlineGame(args.gameId, args.sessionId) };
}
