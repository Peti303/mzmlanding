CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  t  INTEGER NOT NULL,   -- időbélyeg (ms)
  d  TEXT    NOT NULL,   -- Budapest-i nap, YYYY-MM-DD
  v  TEXT    NOT NULL,   -- anonim látogatói hash
  k  TEXT    NOT NULL,   -- 'pv' | 'cta'
  s  TEXT,               -- forrás
  dv TEXT,               -- eszköz
  cm TEXT,               -- kampány
  c  TEXT                -- gomb azonosító
);
CREATE INDEX IF NOT EXISTS idx_events_d ON events(d);
CREATE TABLE IF NOT EXISTS login_fails (ip TEXT NOT NULL, t INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_login_fails ON login_fails(ip, t);
