import "server-only";
import { simulateMultiplayerRound, type MultiplayerSnapshot } from "@/game/multiplayer";
import { hashString } from "@/game/rng";
import type { PrototypeGameState } from "@/game/types";
import { applyCommand } from "@/game/state";
import { copiesForStar, reserveShop, type PoolAvailability } from "@/game/pool";
import { sql } from "./database";
import { ensureOnlineSchema, loadOnlineGame } from "./online-game-store";

export type ReconcileStatus = "NOT_DUE" | "BUSY" | "COMBAT_READY";

function checksum(value: unknown) { return hashString(JSON.stringify(value)).toString(16).padStart(8,"0") }

export async function reconcileShopToCombat(gameId: string): Promise<ReconcileStatus> {
  await ensureOnlineSchema();
  const leaseOwner=crypto.randomUUID();
  const claimed=await sql`WITH due AS (
      SELECT id,round,phase_version FROM online_games WHERE id=${gameId}::uuid AND phase='SHOP' AND phase_ends_at<=now()
    ), created AS (
      INSERT INTO online_combat_jobs (game_id,round,phase_version) SELECT id,round,phase_version FROM due
      ON CONFLICT (game_id,round) DO NOTHING
    )
    UPDATE online_combat_jobs j SET status='CALCULATING',lease_owner=${leaseOwner}::uuid,lease_until=now()+interval '10 seconds',attempt_count=attempt_count+1,last_error=NULL
    FROM due WHERE j.game_id=due.id AND j.round=due.round AND j.phase_version=due.phase_version
      AND (j.status='PENDING' OR (j.status='CALCULATING' AND j.lease_until<now()))
    RETURNING j.round,j.phase_version`;
  if(!claimed[0]){
    const game=await sql`SELECT phase,phase_ends_at<=now() is_due FROM online_games WHERE id=${gameId}::uuid`;
    return game[0]?.phase==="SHOP"&&game[0]?.is_due?"BUSY":"NOT_DUE";
  }
  const round=claimed[0].round as number; const phaseVersion=claimed[0].phase_version as number;
  try{
    const rows=await sql`SELECT p.session_id::text,p.state,g.seed FROM online_game_players p JOIN online_games g ON g.id=p.game_id WHERE p.game_id=${gameId}::uuid AND p.hp>0 AND p.eliminated_at IS NULL ORDER BY p.seat`;
    const players:MultiplayerSnapshot[]=[];
    for(const row of rows){
      const state=(row.state as PrototypeGameState|null)??await loadOnlineGame(gameId,row.session_id);
      if(state)players.push({playerId:row.session_id,state});
    }
    const seed=`${rows[0]?.seed??gameId}:round:${round}`;
    const input={round,seed,players};
    const ledger=simulateMultiplayerRound(input);
    const inputChecksum=checksum(input); const resultChecksum=checksum(ledger);
    const durationSeconds=Math.max(5,Math.ceil(Math.max(0,...ledger.map((entry)=>entry.combat.durationMs))/1000)+2);
    const payload=JSON.stringify(ledger);
    const results=await sql.transaction((tx)=>[
      tx`INSERT INTO online_game_pairings (game_id,round,pairing_index,player_a_id,player_b_id,is_ghost,ghost_owner_id,seed,result)
        SELECT ${gameId}::uuid,${round},(entry->'pairing'->>'index')::integer,(entry->'pairing'->>'playerAId')::uuid,(entry->'pairing'->>'playerBId')::uuid,(entry->'pairing'->>'isGhost')::boolean,NULLIF(entry->'pairing'->>'ghostOwnerId','')::uuid,entry->'combat'->>'seed',entry
        FROM jsonb_array_elements(${payload}::jsonb) entry,online_combat_jobs j
        WHERE j.game_id=${gameId}::uuid AND j.round=${round} AND j.status='CALCULATING' AND j.lease_owner=${leaseOwner}::uuid AND j.lease_until>=now()
        ON CONFLICT (game_id,round,pairing_index) DO NOTHING`,
      tx`UPDATE online_combat_jobs SET status='COMPLETED',input_checksum=${inputChecksum},result_checksum=${resultChecksum},completed_at=now(),lease_until=NULL
        WHERE game_id=${gameId}::uuid AND round=${round} AND phase_version=${phaseVersion} AND status='CALCULATING' AND lease_owner=${leaseOwner}::uuid AND lease_until>=now() RETURNING game_id`,
      tx`UPDATE online_games g SET phase='COMBAT',phase_version=phase_version+1,phase_ends_at=now()+make_interval(secs=>${durationSeconds})
        WHERE g.id=${gameId}::uuid AND g.phase='SHOP' AND g.round=${round} AND g.phase_version=${phaseVersion}
          AND EXISTS (SELECT 1 FROM online_combat_jobs j WHERE j.game_id=g.id AND j.round=g.round AND j.status='COMPLETED' AND j.lease_owner=${leaseOwner}::uuid) RETURNING id`
    ]);
    return results[2].length>0?"COMBAT_READY":"BUSY";
  }catch(error){
    await sql`UPDATE online_combat_jobs SET last_error=${error instanceof Error?error.message:"unknown error"} WHERE game_id=${gameId}::uuid AND round=${round} AND lease_owner=${leaseOwner}::uuid`;
    throw error;
  }
}

export async function reconcileCombatToResult(gameId:string){
  await ensureOnlineSchema();
  const rows=await sql`WITH claimed AS (
      UPDATE online_games SET phase='RESULT',phase_version=phase_version+1,phase_ends_at=now()+interval '5 seconds'
      WHERE id=${gameId}::uuid AND phase='COMBAT' AND phase_ends_at<=now() RETURNING id,round
    ), entries AS (
      SELECT p.result FROM online_game_pairings p JOIN claimed c ON c.id=p.game_id AND c.round=p.round WHERE p.applied_at IS NULL
    ), outcomes AS (
      SELECT (result->'pairing'->>'playerAId')::uuid session_id,(result->>'damageToA')::integer damage,
        CASE WHEN result->'combat'->>'winner'='PLAYER' THEN 1 ELSE 0 END win_count,
        CASE WHEN result->'combat'->>'winner'='PLAYER' THEN 0 ELSE 1 END loss_count FROM entries
      UNION ALL
      SELECT (result->'pairing'->>'playerBId')::uuid,(result->>'damageToB')::integer,
        CASE WHEN result->'combat'->>'winner'='ENEMY' THEN 1 ELSE 0 END,
        CASE WHEN result->'combat'->>'winner'='ENEMY' THEN 0 ELSE 1 END FROM entries WHERE NOT (result->'pairing'->>'isGhost')::boolean
    ), totals AS (
      SELECT session_id,sum(damage)::integer damage,sum(win_count)::integer wins,sum(loss_count)::integer losses FROM outcomes GROUP BY session_id
    ), updated AS (
      UPDATE online_game_players p SET hp=greatest(0,p.hp-t.damage),wins=p.wins+t.wins,losses=p.losses+t.losses,
        eliminated_at=CASE WHEN p.hp-t.damage<=0 THEN coalesce(p.eliminated_at,now()) ELSE p.eliminated_at END,
        state=(coalesce(p.state,'{}'::jsonb)||jsonb_build_object('hp',greatest(0,p.hp-t.damage),'wins',p.wins+t.wins,'losses',p.losses+t.losses,'phase','RESULT','round',(SELECT round FROM claimed),'lastResult',CASE WHEN t.damage>0 THEN '전투 패배 · '||t.damage||' 피해' ELSE '전투 승리' END))
      FROM totals t,claimed c WHERE p.game_id=c.id AND p.session_id=t.session_id RETURNING p.session_id
    ), applied AS (
      UPDATE online_game_pairings p SET applied_at=now() FROM claimed c WHERE p.game_id=c.id AND p.round=c.round AND p.applied_at IS NULL RETURNING p.pairing_index
    ) SELECT (SELECT count(*) FROM claimed)::integer claimed_count,(SELECT count(*) FROM updated)::integer player_count,(SELECT count(*) FROM applied)::integer pairing_count`;
  return rows[0]?.claimed_count>0?"RESULT_READY" as const:"NOT_DUE" as const;
}

export async function reconcileOnlineGame(gameId:string){
  const shop=await reconcileShopToCombat(gameId);
  if(shop==="COMBAT_READY"||shop==="BUSY")return shop;
  const combat=await reconcileCombatToResult(gameId);
  if(combat==="RESULT_READY")return combat;
  return reconcileResult(gameId);
}

export async function reconcileResult(gameId:string){
  await ensureOnlineSchema();
  const games=await sql`SELECT id::text,room_id::text,round,phase_version FROM online_games WHERE id=${gameId}::uuid AND phase='RESULT' AND phase_ends_at<=now()`;
  if(!games[0])return "NOT_DUE" as const;
  const game=games[0];
  const rows=await sql`SELECT session_id::text,nickname_snapshot,hp,gold,level,wins,losses,state,seat FROM online_game_players WHERE game_id=${gameId}::uuid ORDER BY seat`;
  const survivors=rows.filter((row)=>row.hp>0);
  if(survivors.length<=1){
    const recordId=crypto.randomUUID(); const winner=survivors[0]?.nickname_snapshot??null;
    const finished=await sql`WITH finished_game AS (
        UPDATE online_games SET phase='GAME_OVER',phase_version=phase_version+1,finished_at=now(),phase_ends_at=now()
        WHERE id=${gameId}::uuid AND phase='RESULT' AND phase_version=${game.phase_version} AND phase_ends_at<=now() RETURNING room_id,round,created_at,finished_at
      ), finished_room AS (
        UPDATE matchmaking_rooms r SET status='FINISHED',finished_at=f.finished_at,version=version+1 FROM finished_game f WHERE r.id=f.room_id RETURNING r.id,r.name,r.started_at,r.finished_at
      ), inserted AS (
        INSERT INTO completed_game_records (id,room_id,room_name,started_at,ended_at,rounds,winner_nickname,player_nicknames,summary,ledger)
        SELECT ${recordId}::uuid,r.id,r.name,r.started_at,r.finished_at,f.round,${winner},
          (SELECT jsonb_agg(p.nickname_snapshot ORDER BY p.seat) FROM online_game_players p WHERE p.game_id=${gameId}::uuid),
          (SELECT jsonb_build_object('players',jsonb_agg(jsonb_build_object('nickname',p.nickname_snapshot,'seat',p.seat,'hp',p.hp,'wins',p.wins,'losses',p.losses) ORDER BY p.seat),'winner',${winner}) FROM online_game_players p WHERE p.game_id=${gameId}::uuid),
          jsonb_build_object('gameId',${gameId},'rounds',f.round,'pairings',(SELECT coalesce(jsonb_agg(jsonb_build_object('round',p.round,'index',p.pairing_index,'result',p.result) ORDER BY p.round,p.pairing_index),'[]'::jsonb) FROM online_game_pairings p WHERE p.game_id=${gameId}::uuid))
        FROM finished_game f JOIN finished_room r ON r.id=f.room_id ON CONFLICT (room_id) DO NOTHING RETURNING id
      ) SELECT id::text FROM inserted`;
    return finished[0]?"GAME_OVER" as const:"NOT_DUE" as const;
  }
  const transitionOwner=crypto.randomUUID();
  const poolRows=await sql`SELECT unit_base_id,initial_count,available_count,version FROM shared_unit_pools WHERE game_id=${gameId}::uuid ORDER BY unit_base_id`;
  const oldReservations=await sql`SELECT unit_base_id,purchased FROM online_shop_reservations WHERE game_id=${gameId}::uuid AND round=${game.round}`;
  const availability=Object.fromEntries(poolRows.map((row)=>[row.unit_base_id,row.available_count])) as PoolAvailability;
  for(const reservation of oldReservations)if(!reservation.purchased)availability[reservation.unit_base_id as keyof PoolAvailability]+=1;
  const eliminatedStates=rows.filter((row)=>row.hp<=0).map((row)=>{
    const state=structuredClone(row.state as PrototypeGameState);
    for(const unit of state.units)availability[unit.baseId]+=copiesForStar(unit.starLevel);
    state.units=[];state.shop=[];state.version+=1;
    return {sessionId:row.session_id,state};
  });
  const nextStates=survivors.map((row)=>{
    const state={...(row.state as PrototypeGameState),phase:"RESULT" as const,round:game.round,hp:row.hp,gold:row.gold,level:row.level,wins:row.wins,losses:row.losses};
    const next=applyCommand(state,{type:"NEXT_ROUND"});
    if(next.error)throw new Error(next.error);
    const rolled=reserveShop(`${next.state.seed}:shop:${next.state.round}:${next.state.version}`,availability);
    if(!rolled.complete)throw new Error("공유 풀 재고가 부족해 다음 상점을 만들 수 없습니다.");
    next.state.shop=rolled.shop; Object.assign(availability,rolled.remaining);
    return {sessionId:row.session_id,state:next.state};
  });
  const payload=JSON.stringify([...nextStates,...eliminatedStates]); const poolPayload=JSON.stringify(poolRows.map((row)=>({unit_base_id:row.unit_base_id,available_count:Math.min(row.initial_count,availability[row.unit_base_id as keyof PoolAvailability]),expected_version:row.version})));
  const reservationsPayload=JSON.stringify(nextStates.flatMap((entry)=>entry.state.shop.map((slot)=>({session_id:entry.sessionId,round:entry.state.round,slot:slot.slot,unit_base_id:slot.baseId}))));
  const advanced=await sql`WITH pool_values AS (
      SELECT * FROM jsonb_to_recordset(${poolPayload}::jsonb) item(unit_base_id text,available_count integer,expected_version integer)
    ), claimed AS (
      UPDATE online_games SET phase='SHOP',round=round+1,phase_version=phase_version+1,phase_ends_at=now()+interval '30 seconds',transition_owner=${transitionOwner}::uuid
      WHERE id=${gameId}::uuid AND phase='RESULT' AND phase_version=${game.phase_version} AND phase_ends_at<=now()
        AND NOT EXISTS (SELECT 1 FROM pool_values v LEFT JOIN shared_unit_pools p ON p.game_id=${gameId}::uuid AND p.unit_base_id=v.unit_base_id WHERE p.version IS DISTINCT FROM v.expected_version)
      RETURNING id,round
    ), pools AS (
      UPDATE shared_unit_pools p SET available_count=v.available_count,version=p.version+1 FROM pool_values v,claimed c WHERE p.game_id=c.id AND p.unit_base_id=v.unit_base_id RETURNING p.unit_base_id
    ), states AS (
      SELECT entry->>'sessionId' session_id,entry->'state' state FROM jsonb_array_elements(${payload}::jsonb) entry
    ), updated AS (
      UPDATE online_game_players p SET state=s.state,state_version=(s.state->>'version')::integer,hp=(s.state->>'hp')::integer,gold=(s.state->>'gold')::integer,level=(s.state->>'level')::integer,wins=(s.state->>'wins')::integer,losses=(s.state->>'losses')::integer
      FROM states s,claimed c WHERE p.game_id=c.id AND p.session_id=(s.session_id)::uuid AND (SELECT count(*) FROM pools)=(SELECT count(*) FROM pool_values) RETURNING p.session_id
    ), reservations AS (
      INSERT INTO online_shop_reservations (game_id,session_id,round,slot,unit_base_id) SELECT ${gameId}::uuid,(item->>'session_id')::uuid,(item->>'round')::integer,(item->>'slot')::integer,item->>'unit_base_id' FROM jsonb_array_elements(${reservationsPayload}::jsonb) item,claimed c WHERE EXISTS (SELECT 1 FROM updated) RETURNING slot
    ) SELECT (SELECT count(*) FROM claimed)::integer claimed_count,(SELECT count(*) FROM updated)::integer player_count,(SELECT count(*) FROM reservations)::integer reservation_count`;
  return advanced[0]?.claimed_count>0?"SHOP_READY" as const:"NOT_DUE" as const;
}
