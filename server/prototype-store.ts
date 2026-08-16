import "server-only";
import { neon } from "@neondatabase/serverless";
import { createGame } from "@/game/state";
import type { PrototypeGameState } from "@/game/types";

const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
if (!connectionString) throw new Error("DATABASE_URL 또는 POSTGRES_URL이 필요합니다.");
const sql = neon(connectionString);

let schemaReady: Promise<void> | null = null;
function ensureSchema() {
  schemaReady ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS prototype_game_states (
      session_id text PRIMARY KEY,
      version integer NOT NULL,
      state jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE TABLE IF NOT EXISTS prototype_game_actions (
      action_id uuid PRIMARY KEY,
      session_id text NOT NULL REFERENCES prototype_game_states(session_id) ON DELETE CASCADE,
      response jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`;
    await sql`CREATE INDEX IF NOT EXISTS prototype_game_actions_session_idx ON prototype_game_actions(session_id, created_at DESC)`;
  })();
  return schemaReady;
}

export async function loadOrCreateGame(sessionId: string) {
  await ensureSchema();
  const initial = createGame(`online-${sessionId}`);
  await sql`INSERT INTO prototype_game_states (session_id, version, state) VALUES (${sessionId}, ${initial.version}, ${JSON.stringify(initial)}::jsonb) ON CONFLICT (session_id) DO NOTHING`;
  const rows = await sql`SELECT state FROM prototype_game_states WHERE session_id = ${sessionId}`;
  return rows[0].state as PrototypeGameState;
}

export async function loadSavedAction(sessionId: string, actionId: string) {
  await ensureSchema();
  const rows = await sql`SELECT response FROM prototype_game_actions WHERE session_id = ${sessionId} AND action_id = ${actionId}::uuid`;
  return rows[0]?.response as PrototypeGameState | undefined;
}

export async function saveGameCommand(args: { sessionId: string; actionId: string; expectedVersion: number; state: PrototypeGameState }) {
  await ensureSchema();
  const rows = await sql`
    WITH duplicate AS (
      SELECT response FROM prototype_game_actions WHERE action_id = ${args.actionId} AND session_id = ${args.sessionId}
    ), updated AS (
      UPDATE prototype_game_states
      SET state = ${JSON.stringify(args.state)}::jsonb, version = ${args.state.version}, updated_at = now()
      WHERE session_id = ${args.sessionId} AND version = ${args.expectedVersion} AND NOT EXISTS (SELECT 1 FROM duplicate)
      RETURNING state
    ), recorded AS (
      INSERT INTO prototype_game_actions (action_id, session_id, response)
      SELECT ${args.actionId}::uuid, ${args.sessionId}, state FROM updated
      ON CONFLICT (action_id) DO NOTHING
      RETURNING response
    )
    SELECT response, 'APPLIED' AS status FROM recorded
    UNION ALL
    SELECT response, 'DUPLICATE' AS status FROM duplicate
    LIMIT 1`;
  if (rows[0]) return { status: rows[0].status as "APPLIED" | "DUPLICATE", state: rows[0].response as PrototypeGameState };
  const latest = await loadOrCreateGame(args.sessionId);
  return { status: "CONFLICT" as const, state: latest };
}
