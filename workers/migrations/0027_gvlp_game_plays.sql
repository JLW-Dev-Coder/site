CREATE TABLE IF NOT EXISTS gvlp_game_plays (
  play_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  game_slug TEXT NOT NULL,
  tokens_cost INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);