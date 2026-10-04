-- Waypoint database schema. Applied idempotently on every server start.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,   -- always stored lowercased/trimmed for case-insensitive uniqueness
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_name  TEXT NOT NULL,
  latitude    REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude   REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  visited_on  TEXT NOT NULL,             -- 'YYYY-MM-DD'
  note        TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pins_user_id ON pins(user_id);

-- Denylist of revoked (logged-out) JWT ids, so sign-out has a real server-side
-- effect even though the auth scheme is otherwise stateless. Rows are pruned
-- once their token would have expired anyway (see routes/auth.js).
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti        TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL           -- unix seconds, matches the JWT 'exp' claim
);
