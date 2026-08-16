CREATE TABLE IF NOT EXISTS prototype_game_states (
  session_id text PRIMARY KEY,
  version integer NOT NULL,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS prototype_game_actions (
  action_id uuid PRIMARY KEY,
  session_id text NOT NULL REFERENCES prototype_game_states(session_id) ON DELETE CASCADE,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS prototype_game_actions_session_idx ON prototype_game_actions(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS anonymous_sessions (
  id uuid PRIMARY KEY, nickname text,
  created_at timestamptz NOT NULL DEFAULT now(), last_seen_at timestamptz NOT NULL DEFAULT now(),
  CHECK (nickname IS NULL OR char_length(nickname) BETWEEN 1 AND 16)
);
CREATE TABLE IF NOT EXISTS matchmaking_rooms (
  id uuid PRIMARY KEY, name text NOT NULL,
  host_session_id uuid NOT NULL REFERENCES anonymous_sessions(id),
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','STARTED','FINISHED')),
  max_players integer NOT NULL DEFAULT 8 CHECK (max_players BETWEEN 2 AND 8),
  version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz, finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS matchmaking_room_players (
  room_id uuid NOT NULL REFERENCES matchmaking_rooms(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES anonymous_sessions(id), nickname_snapshot text NOT NULL,
  seat integer NOT NULL CHECK (seat BETWEEN 0 AND 7), ready boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (room_id,session_id), UNIQUE (room_id,seat)
);
CREATE TABLE IF NOT EXISTS completed_game_records (
  id uuid PRIMARY KEY, room_id uuid NOT NULL UNIQUE, room_name text NOT NULL,
  started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL DEFAULT now(), rounds integer NOT NULL,
  winner_nickname text, player_nicknames jsonb NOT NULL, summary jsonb NOT NULL, ledger jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS online_games (
  id uuid PRIMARY KEY,
  room_id uuid NOT NULL UNIQUE REFERENCES matchmaking_rooms(id),
  phase text NOT NULL DEFAULT 'SHOP' CHECK (phase IN ('SHOP','COMBAT','RESULT','GAME_OVER')),
  round integer NOT NULL DEFAULT 1 CHECK (round > 0),
  phase_version integer NOT NULL DEFAULT 1,
  phase_ends_at timestamptz NOT NULL,
  seed text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS online_game_players (
  game_id uuid NOT NULL REFERENCES online_games(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES anonymous_sessions(id),
  nickname_snapshot text NOT NULL,
  seat integer NOT NULL CHECK (seat BETWEEN 0 AND 7),
  hp integer NOT NULL DEFAULT 100 CHECK (hp BETWEEN 0 AND 100),
  gold integer NOT NULL DEFAULT 8 CHECK (gold >= 0),
  level integer NOT NULL DEFAULT 3 CHECK (level BETWEEN 1 AND 9),
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  eliminated_at timestamptz,
  state_version integer NOT NULL DEFAULT 1,
  board jsonb NOT NULL DEFAULT '[]'::jsonb,
  bench jsonb NOT NULL DEFAULT '[]'::jsonb,
  shop jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (game_id, session_id),
  UNIQUE (game_id, seat)
);

CREATE TABLE IF NOT EXISTS online_game_pairings (
  game_id uuid NOT NULL REFERENCES online_games(id) ON DELETE CASCADE,
  round integer NOT NULL,
  pairing_index integer NOT NULL,
  player_a_id uuid NOT NULL REFERENCES anonymous_sessions(id),
  player_b_id uuid NOT NULL REFERENCES anonymous_sessions(id),
  is_ghost boolean NOT NULL DEFAULT false,
  ghost_owner_id uuid REFERENCES anonymous_sessions(id),
  seed text NOT NULL,
  result jsonb,
  applied_at timestamptz,
  PRIMARY KEY (game_id, round, pairing_index)
);
CREATE INDEX IF NOT EXISTS matchmaking_rooms_status_created_idx ON matchmaking_rooms(status,created_at DESC);
CREATE INDEX IF NOT EXISTS completed_game_records_ended_idx ON completed_game_records(ended_at DESC);
