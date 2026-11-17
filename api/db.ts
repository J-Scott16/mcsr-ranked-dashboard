import { createClient } from '@libsql/client';

// Local SQLite file for now. When we deploy, this url changes to the Turso database.
export const db = createClient({
  url: 'file:./data.db',
});

const client = createClient({
  url: process.env.TURSO_DATABASE_URL ?? 'file:./data.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});



export async function initDb() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS players (
      uuid TEXT PRIMARY KEY,
      nickname TEXT NOT NULL,
      elo INTEGER,
      elo_rank INTEGER,
      updated_at INTEGER NOT NULL,
      raw TEXT
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS matches (
      match_id INTEGER NOT NULL,
      player_uuid TEXT NOT NULL,
      opponent_uuid TEXT,
      opponent_nickname TEXT,
      result TEXT,
      seed_type TEXT,
      bastion_type TEXT,
      date INTEGER,
      forfeited INTEGER NOT NULL DEFAULT 0,
      elo_change INTEGER,
      elo_after INTEGER,
      raw TEXT NOT NULL,
      PRIMARY KEY (match_id, player_uuid)
    )
  `);
  await db.execute(`
  CREATE TABLE IF NOT EXISTS cache (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

await db.execute(`
  CREATE TABLE IF NOT EXISTS match_details (
    match_id INTEGER PRIMARY KEY,
    raw TEXT NOT NULL
  )
`);
}
