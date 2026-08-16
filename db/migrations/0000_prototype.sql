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
