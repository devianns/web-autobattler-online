import "server-only";
import { auditPoolBalance } from "@/game/pool";
import { ensureOnlineSchema } from "./online-game-store";
import { sql } from "./database";

export async function auditSharedPool(gameId:string,sessionId:string){
  await ensureOnlineSchema();
  const authorized=await sql`SELECT 1 FROM online_games g JOIN matchmaking_rooms r ON r.id=g.room_id WHERE g.id=${gameId}::uuid AND r.host_session_id=${sessionId}::uuid`;
  if(!authorized[0])return null;
  const rows=await sql`WITH reserved AS (
      SELECT unit_base_id,count(*)::integer count FROM online_shop_reservations WHERE game_id=${gameId}::uuid AND NOT purchased GROUP BY unit_base_id
    ), owned AS (
      SELECT unit->>'baseId' unit_base_id,sum(CASE (unit->>'starLevel')::integer WHEN 1 THEN 1 WHEN 2 THEN 3 WHEN 3 THEN 9 ELSE 0 END)::integer count
      FROM online_game_players p CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.state->'units','[]'::jsonb)) unit WHERE p.game_id=${gameId}::uuid GROUP BY unit->>'baseId'
    ) SELECT p.unit_base_id,p.initial_count,p.available_count,coalesce(r.count,0)::integer reserved_count,coalesce(o.count,0)::integer owned_count
    FROM shared_unit_pools p LEFT JOIN reserved r USING(unit_base_id) LEFT JOIN owned o USING(unit_base_id) WHERE p.game_id=${gameId}::uuid ORDER BY p.unit_base_id`;
  const units=rows.map((row)=>({unitBaseId:row.unit_base_id,...auditPoolBalance({initial:row.initial_count,available:row.available_count,reserved:row.reserved_count,owned:row.owned_count})}));
  return {gameId,valid:units.every((unit)=>unit.valid),units};
}
