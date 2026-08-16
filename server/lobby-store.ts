import "server-only";
import { sql } from "./database";
import type { GameHistoryDetail, GameHistorySummary, RoomDetail, RoomSummary, SessionProfile } from "@/matchmaking/types";

let schemaReady: Promise<void> | null = null;
export function ensureLobbySchema() {
  schemaReady ??= (async () => {
    await sql`CREATE TABLE IF NOT EXISTS anonymous_sessions (id uuid PRIMARY KEY, nickname text, created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(), CHECK (nickname IS NULL OR char_length(nickname) BETWEEN 1 AND 16))`;
    await sql`CREATE TABLE IF NOT EXISTS matchmaking_rooms (id uuid PRIMARY KEY, name text NOT NULL, host_session_id uuid NOT NULL REFERENCES anonymous_sessions(id), status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','STARTED','FINISHED')), max_players integer NOT NULL DEFAULT 8 CHECK (max_players BETWEEN 2 AND 8), version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz)`;
    await sql`CREATE TABLE IF NOT EXISTS matchmaking_room_players (room_id uuid NOT NULL REFERENCES matchmaking_rooms(id) ON DELETE CASCADE, session_id uuid NOT NULL REFERENCES anonymous_sessions(id), nickname_snapshot text NOT NULL, seat integer NOT NULL CHECK (seat BETWEEN 0 AND 7), ready boolean NOT NULL DEFAULT false, joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (room_id, session_id), UNIQUE (room_id, seat))`;
    await sql`CREATE TABLE IF NOT EXISTS completed_game_records (id uuid PRIMARY KEY, room_id uuid NOT NULL UNIQUE, room_name text NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL DEFAULT now(), rounds integer NOT NULL, winner_nickname text, player_nicknames jsonb NOT NULL, summary jsonb NOT NULL, ledger jsonb NOT NULL)`;
    await sql`CREATE TABLE IF NOT EXISTS online_games (id uuid PRIMARY KEY, room_id uuid NOT NULL UNIQUE REFERENCES matchmaking_rooms(id), phase text NOT NULL DEFAULT 'SHOP' CHECK (phase IN ('SHOP','COMBAT','RESULT','GAME_OVER')), round integer NOT NULL DEFAULT 1 CHECK (round > 0), phase_version integer NOT NULL DEFAULT 1, phase_ends_at timestamptz NOT NULL, seed text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz)`;
    await sql`ALTER TABLE online_games ADD COLUMN IF NOT EXISTS transition_owner uuid`;
    await sql`CREATE TABLE IF NOT EXISTS online_game_players (game_id uuid NOT NULL REFERENCES online_games(id) ON DELETE CASCADE, session_id uuid NOT NULL REFERENCES anonymous_sessions(id), nickname_snapshot text NOT NULL, seat integer NOT NULL CHECK (seat BETWEEN 0 AND 7), hp integer NOT NULL DEFAULT 100 CHECK (hp BETWEEN 0 AND 100), gold integer NOT NULL DEFAULT 8 CHECK (gold >= 0), level integer NOT NULL DEFAULT 3 CHECK (level BETWEEN 1 AND 9), wins integer NOT NULL DEFAULT 0, losses integer NOT NULL DEFAULT 0, eliminated_at timestamptz, state_version integer NOT NULL DEFAULT 1, board jsonb NOT NULL DEFAULT '[]'::jsonb, bench jsonb NOT NULL DEFAULT '[]'::jsonb, shop jsonb NOT NULL DEFAULT '[]'::jsonb, PRIMARY KEY (game_id,session_id), UNIQUE (game_id,seat))`;
    await sql`CREATE TABLE IF NOT EXISTS online_game_pairings (game_id uuid NOT NULL REFERENCES online_games(id) ON DELETE CASCADE, round integer NOT NULL, pairing_index integer NOT NULL, player_a_id uuid NOT NULL REFERENCES anonymous_sessions(id), player_b_id uuid NOT NULL REFERENCES anonymous_sessions(id), is_ghost boolean NOT NULL DEFAULT false, ghost_owner_id uuid REFERENCES anonymous_sessions(id), seed text NOT NULL, result jsonb, applied_at timestamptz, PRIMARY KEY (game_id,round,pairing_index))`;
    await sql`CREATE TABLE IF NOT EXISTS online_combat_jobs (game_id uuid NOT NULL REFERENCES online_games(id) ON DELETE CASCADE, round integer NOT NULL, phase_version integer NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CALCULATING','COMPLETED')), lease_owner uuid, lease_until timestamptz, attempt_count integer NOT NULL DEFAULT 0, input_checksum text, result_checksum text, last_error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, PRIMARY KEY (game_id,round), UNIQUE (game_id,phase_version))`;
    await sql`CREATE INDEX IF NOT EXISTS matchmaking_rooms_status_created_idx ON matchmaking_rooms(status, created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS completed_game_records_ended_idx ON completed_game_records(ended_at DESC)`;
  })();
  return schemaReady;
}

export async function profile(sessionId: string): Promise<SessionProfile> {
  await ensureLobbySchema();
  const rows = await sql`INSERT INTO anonymous_sessions (id, last_seen_at) VALUES (${sessionId}::uuid, now()) ON CONFLICT (id) DO UPDATE SET last_seen_at = now() RETURNING id::text, nickname, created_at`;
  const active = await sql`SELECT p.room_id::text FROM matchmaking_room_players p JOIN matchmaking_rooms r ON r.id=p.room_id WHERE p.session_id=${sessionId}::uuid AND r.status IN ('WAITING','STARTED') ORDER BY p.joined_at DESC LIMIT 1`;
  return { id: rows[0].id, nickname: rows[0].nickname, createdAt: rows[0].created_at, serverNow: new Date().toISOString(), activeRoomId: active[0]?.room_id ?? null };
}

export async function setNickname(sessionId: string, nickname: string) {
  await ensureLobbySchema();
  const rows = await sql`INSERT INTO anonymous_sessions (id, nickname, last_seen_at) VALUES (${sessionId}::uuid, ${nickname}, now()) ON CONFLICT (id) DO UPDATE SET nickname = EXCLUDED.nickname, last_seen_at = now() RETURNING id::text, nickname, created_at`;
  const active = await sql`SELECT p.room_id::text FROM matchmaking_room_players p JOIN matchmaking_rooms r ON r.id=p.room_id WHERE p.session_id=${sessionId}::uuid AND r.status IN ('WAITING','STARTED') ORDER BY p.joined_at DESC LIMIT 1`;
  return { id: rows[0].id, nickname: rows[0].nickname, createdAt: rows[0].created_at, serverNow: new Date().toISOString(), activeRoomId: active[0]?.room_id ?? null } as SessionProfile;
}

export async function listRooms(): Promise<RoomSummary[]> {
  await ensureLobbySchema();
  const rows = await sql`SELECT r.id::text, r.name, r.status, r.max_players, r.created_at, r.started_at, s.nickname host_nickname, count(p.session_id)::int player_count FROM matchmaking_rooms r JOIN anonymous_sessions s ON s.id=r.host_session_id LEFT JOIN matchmaking_room_players p ON p.room_id=r.id WHERE r.status='WAITING' GROUP BY r.id,s.nickname ORDER BY r.created_at DESC LIMIT 50`;
  return rows.map((row) => ({ id: row.id, name: row.name, status: row.status, maxPlayers: row.max_players, createdAt: row.created_at, startedAt: row.started_at, hostNickname: row.host_nickname, playerCount: row.player_count })) as RoomSummary[];
}

export async function createRoom(sessionId: string, name: string) {
  await ensureLobbySchema();
  const id = crypto.randomUUID();
  const rows = await sql`WITH owner AS (SELECT id,nickname FROM anonymous_sessions WHERE id=${sessionId}::uuid AND nickname IS NOT NULL), room AS (INSERT INTO matchmaking_rooms (id,name,host_session_id) SELECT ${id}::uuid,${name},id FROM owner RETURNING id), player AS (INSERT INTO matchmaking_room_players (room_id,session_id,nickname_snapshot,seat,ready) SELECT room.id,owner.id,owner.nickname,0,true FROM room,owner RETURNING room_id) SELECT room_id::text FROM player`;
  return rows[0]?.room_id as string | undefined;
}

export async function roomDetail(roomId: string, viewerId: string): Promise<RoomDetail | null> {
  await ensureLobbySchema();
  const rooms = await sql`SELECT r.id::text,r.name,r.status,r.max_players,r.version,r.created_at,r.started_at,r.host_session_id::text,s.nickname host_nickname,g.id::text game_id FROM matchmaking_rooms r JOIN anonymous_sessions s ON s.id=r.host_session_id LEFT JOIN online_games g ON g.room_id=r.id WHERE r.id=${roomId}::uuid`;
  if (!rooms[0]) return null;
  const players = await sql`SELECT p.session_id::text,p.nickname_snapshot,p.seat,p.ready,p.joined_at,(p.session_id=r.host_session_id) is_host FROM matchmaking_room_players p JOIN matchmaking_rooms r ON r.id=p.room_id WHERE p.room_id=${roomId}::uuid ORDER BY p.seat`;
  const room = rooms[0];
  return { id: room.id, name: room.name, status: room.status, maxPlayers: room.max_players, version: room.version, gameId: room.game_id ?? null, createdAt: room.created_at, startedAt: room.started_at, hostNickname: room.host_nickname, playerCount: players.length, viewerSessionId: viewerId, viewerIsMember: players.some((p) => p.session_id === viewerId), viewerIsHost: room.host_session_id === viewerId, players: players.map((p) => ({ sessionId: p.session_id, nickname: p.nickname_snapshot, seat: p.seat, ready: p.ready, isHost: p.is_host, joinedAt: p.joined_at })) } as RoomDetail;
}

export async function joinRoom(roomId: string, sessionId: string) {
  await ensureLobbySchema();
  const rows = await sql`INSERT INTO matchmaking_room_players (room_id,session_id,nickname_snapshot,seat) SELECT r.id,s.id,s.nickname,slot.seat FROM matchmaking_rooms r JOIN anonymous_sessions s ON s.id=${sessionId}::uuid CROSS JOIN LATERAL (SELECT candidate seat FROM generate_series(0,r.max_players-1) candidate WHERE NOT EXISTS (SELECT 1 FROM matchmaking_room_players p WHERE p.room_id=r.id AND p.seat=candidate) ORDER BY candidate LIMIT 1) slot WHERE r.id=${roomId}::uuid AND r.status='WAITING' AND s.nickname IS NOT NULL AND (SELECT count(*) FROM matchmaking_room_players p WHERE p.room_id=r.id)<r.max_players ON CONFLICT (room_id,session_id) DO NOTHING RETURNING room_id`;
  return rows.length > 0;
}

export async function setReady(roomId: string, sessionId: string, ready: boolean) {
  await ensureLobbySchema();
  const rows = await sql`UPDATE matchmaking_room_players p SET ready=${ready} FROM matchmaking_rooms r WHERE p.room_id=r.id AND r.id=${roomId}::uuid AND p.session_id=${sessionId}::uuid AND r.status='WAITING' AND r.host_session_id<>p.session_id RETURNING p.room_id`;
  return rows.length > 0;
}

export async function startRoom(roomId: string, sessionId: string) {
  await ensureLobbySchema();
  const gameId = crypto.randomUUID();
  const seed = `online:${roomId}:${gameId}`;
  const rows = await sql`WITH started AS (UPDATE matchmaking_rooms r SET status='STARTED',started_at=now(),version=version+1 WHERE r.id=${roomId}::uuid AND r.host_session_id=${sessionId}::uuid AND r.status='WAITING' AND (SELECT count(*) FROM matchmaking_room_players p WHERE p.room_id=r.id)>=2 AND NOT EXISTS (SELECT 1 FROM matchmaking_room_players p WHERE p.room_id=r.id AND p.session_id<>r.host_session_id AND NOT p.ready) RETURNING r.id), game AS (INSERT INTO online_games (id,room_id,phase_ends_at,seed) SELECT ${gameId}::uuid,started.id,now()+interval '30 seconds',${seed} FROM started ON CONFLICT (room_id) DO NOTHING RETURNING id,room_id), players AS (INSERT INTO online_game_players (game_id,session_id,nickname_snapshot,seat) SELECT game.id,p.session_id,p.nickname_snapshot,p.seat FROM game JOIN matchmaking_room_players p ON p.room_id=game.room_id RETURNING game_id) SELECT game_id FROM players LIMIT 1`;
  return rows.length > 0;
}

export async function leaveRoom(roomId: string, sessionId: string) {
  await ensureLobbySchema();
  const host = await sql`SELECT host_session_id::text,status FROM matchmaking_rooms WHERE id=${roomId}::uuid`;
  if (!host[0] || host[0].status !== "WAITING") return false;
  if (host[0].host_session_id === sessionId) await sql`DELETE FROM matchmaking_rooms WHERE id=${roomId}::uuid AND host_session_id=${sessionId}::uuid AND status='WAITING'`;
  else await sql`DELETE FROM matchmaking_room_players WHERE room_id=${roomId}::uuid AND session_id=${sessionId}::uuid`;
  return true;
}

export async function finishRoom(roomId: string, sessionId: string, payload: { rounds: number; winnerNickname: string | null; summary: unknown; ledger: unknown }) {
  await ensureLobbySchema();
  const id = crypto.randomUUID();
  const rows = await sql`WITH finished AS (UPDATE matchmaking_rooms r SET status='FINISHED',finished_at=now(),version=version+1 WHERE r.id=${roomId}::uuid AND r.status='STARTED' AND EXISTS (SELECT 1 FROM matchmaking_room_players p WHERE p.room_id=r.id AND p.session_id=${sessionId}::uuid) RETURNING r.*), inserted AS (INSERT INTO completed_game_records (id,room_id,room_name,started_at,rounds,winner_nickname,player_nicknames,summary,ledger) SELECT ${id}::uuid,f.id,f.name,f.started_at,${payload.rounds},${payload.winnerNickname},(SELECT jsonb_agg(p.nickname_snapshot ORDER BY p.seat) FROM matchmaking_room_players p WHERE p.room_id=f.id),${JSON.stringify(payload.summary)}::jsonb,${JSON.stringify(payload.ledger)}::jsonb FROM finished f ON CONFLICT (room_id) DO NOTHING RETURNING id) SELECT id::text FROM inserted`;
  return rows[0]?.id as string | undefined;
}

export async function listHistory(): Promise<GameHistorySummary[]> {
  await ensureLobbySchema();
  const rows = await sql`SELECT id::text,room_id::text,room_name,started_at,ended_at,rounds,winner_nickname,player_nicknames,summary FROM completed_game_records ORDER BY ended_at DESC LIMIT 100`;
  return rows.map((r) => ({ id:r.id,roomId:r.room_id,roomName:r.room_name,startedAt:r.started_at,endedAt:r.ended_at,rounds:r.rounds,winnerNickname:r.winner_nickname,playerNicknames:r.player_nicknames,summary:r.summary })) as GameHistorySummary[];
}

export async function historyDetail(id: string): Promise<GameHistoryDetail | null> {
  await ensureLobbySchema();
  const rows = await sql`SELECT id::text,room_id::text,room_name,started_at,ended_at,rounds,winner_nickname,player_nicknames,summary,ledger FROM completed_game_records WHERE id=${id}::uuid`;
  if (!rows[0]) return null; const r=rows[0];
  return { id:r.id,roomId:r.room_id,roomName:r.room_name,startedAt:r.started_at,endedAt:r.ended_at,rounds:r.rounds,winnerNickname:r.winner_nickname,playerNicknames:r.player_nicknames,summary:r.summary,ledger:r.ledger } as GameHistoryDetail;
}
