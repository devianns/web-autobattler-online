import "server-only";
import { createGame, type GameCommand } from "@/game/state";
import type { PrototypeGameState } from "@/game/types";
import { projectCombatForPlayer, type RoundCombatLedger } from "@/game/multiplayer";
import { UNIT_POOL_COUNTS } from "@/game/content";
import { copiesForStar, reserveShop, type PoolAvailability } from "@/game/pool";
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
  const poolDefaults=JSON.stringify(Object.entries(UNIT_POOL_COUNTS).map(([unitBaseId,count])=>({unitBaseId,count})));
  await sql`INSERT INTO shared_unit_pools (game_id,unit_base_id,initial_count,available_count) SELECT ${gameId}::uuid,item.unit_base_id,item.count,item.count FROM jsonb_to_recordset(${poolDefaults}::jsonb) item(unit_base_id text,count integer) ON CONFLICT (game_id,unit_base_id) DO NOTHING`;
  for(let attempt=0;attempt<4;attempt+=1){
    const poolRows=await sql`SELECT unit_base_id,available_count,version FROM shared_unit_pools WHERE game_id=${gameId}::uuid ORDER BY unit_base_id`;
    const availability=Object.fromEntries(poolRows.map((row)=>[row.unit_base_id,row.available_count])) as PoolAvailability;
    const reservation=reserveShop(`${rows[0].seed}:player:${rows[0].seat}:shop:1:1`,availability);
    if(!reservation.complete)throw new Error("공유 풀 재고가 부족해 초기 상점을 만들 수 없습니다.");
    const initial=createGame(`${rows[0].seed}:player:${rows[0].seat}`); initial.shop=reservation.shop;
    const requested=Object.entries(reservation.reserved).map(([unitBaseId,count])=>({unit_base_id:unitBaseId,count,expected_version:poolRows.find((row)=>row.unit_base_id===unitBaseId)?.version}));
    const requestJson=JSON.stringify(requested); const slotsJson=JSON.stringify(reservation.shop); const stateJson=JSON.stringify(initial);
    const transaction=await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${gameId},0))`,
      sql`WITH requested AS (SELECT * FROM jsonb_to_recordset(${requestJson}::jsonb) item(unit_base_id text,count integer,expected_version integer)), valid AS (
          SELECT count(*)=(SELECT count(*) FROM requested) ok FROM requested r JOIN shared_unit_pools p ON p.game_id=${gameId}::uuid AND p.unit_base_id=r.unit_base_id AND p.version=r.expected_version AND p.available_count>=r.count
          WHERE EXISTS (SELECT 1 FROM online_game_players gp WHERE gp.game_id=${gameId}::uuid AND gp.session_id=${sessionId}::uuid AND gp.state IS NULL)
        ), reserved AS (
          UPDATE shared_unit_pools p SET available_count=p.available_count-r.count,version=p.version+1 FROM requested r,valid v WHERE v.ok AND p.game_id=${gameId}::uuid AND p.unit_base_id=r.unit_base_id AND p.version=r.expected_version RETURNING p.unit_base_id
        ), initialized AS (
          UPDATE online_game_players SET state=${stateJson}::jsonb,state_version=${initial.version} WHERE game_id=${gameId}::uuid AND session_id=${sessionId}::uuid AND state IS NULL AND (SELECT count(*) FROM reserved)=(SELECT count(*) FROM requested) RETURNING state
        ), reservations AS (
          INSERT INTO online_shop_reservations (game_id,session_id,round,slot,unit_base_id) SELECT ${gameId}::uuid,${sessionId}::uuid,1,(slot->>'slot')::integer,slot->>'baseId' FROM jsonb_array_elements(${slotsJson}::jsonb) slot,initialized RETURNING slot
        ) SELECT state,(SELECT count(*) FROM reservations)::integer reservation_count FROM initialized`
    ]);
    if(transaction[1][0]?.reservation_count===5)return transaction[1][0].state as PrototypeGameState;
    const existing=await sql`SELECT state FROM online_game_players WHERE game_id=${gameId}::uuid AND session_id=${sessionId}::uuid`;
    if(existing[0]?.state&&Object.keys(existing[0].state).length>0)return existing[0].state as PrototypeGameState;
  }
  throw new Error("공유 풀 경합으로 초기 상점 생성에 실패했습니다.");
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

export async function saveOnlineCommand(args: { gameId: string; sessionId: string; actionId: string; expectedVersion: number; state: PrototypeGameState; previousState: PrototypeGameState; command: GameCommand }) {
  await ensureOnlineSchema();
  const buySlot=args.command.type==="BUY"?args.command.slot:-1;
  const soldUid=args.command.type==="SELL"?args.command.uid:null;
  const sold=soldUid?args.previousState.units.find((unit)=>unit.uid===soldUid):undefined;
  const returnBase=sold?.baseId??""; const returnCount=sold?copiesForStar(sold.starLevel):0;
  const rows = await sql`WITH duplicate AS (
      SELECT response FROM online_game_actions WHERE game_id=${args.gameId}::uuid AND session_id=${args.sessionId}::uuid AND action_id=${args.actionId}::uuid
    ), updated AS (
      UPDATE online_game_players SET state=${JSON.stringify(args.state)}::jsonb,state_version=${args.state.version}
      WHERE game_id=${args.gameId}::uuid AND session_id=${args.sessionId}::uuid AND state_version=${args.expectedVersion} AND NOT EXISTS (SELECT 1 FROM duplicate)
        AND (${buySlot}<0 OR EXISTS (SELECT 1 FROM online_shop_reservations r WHERE r.game_id=${args.gameId}::uuid AND r.session_id=${args.sessionId}::uuid AND r.round=${args.state.round} AND r.slot=${buySlot} AND NOT r.purchased))
      RETURNING state
    ), purchased AS (
      UPDATE online_shop_reservations r SET purchased=true FROM updated u WHERE ${buySlot}>=0 AND r.game_id=${args.gameId}::uuid AND r.session_id=${args.sessionId}::uuid AND r.round=${args.state.round} AND r.slot=${buySlot} AND NOT r.purchased RETURNING r.slot
    ), returned AS (
      UPDATE shared_unit_pools p SET available_count=least(p.initial_count,p.available_count+${returnCount}),version=p.version+1 FROM updated u WHERE ${returnCount}>0 AND p.game_id=${args.gameId}::uuid AND p.unit_base_id=${returnBase} RETURNING p.unit_base_id
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
