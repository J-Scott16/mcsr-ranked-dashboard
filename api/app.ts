import express from 'express';
import cors from 'cors';
import { db } from './db.js';


const MCSR_API = 'https://api.mcsrranked.com';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/player/:username', async (req, res) => {
  const username = req.params.username;
  const now = Math.floor(Date.now() / 1000);

  const cached = await db.execute({
    sql: 'SELECT * FROM players WHERE nickname = ?',
    args: [username],
  });

  if (cached.rows.length > 0) {
    const row = cached.rows[0] as any;
    const cachedPlayer = JSON.parse(row.raw);

    // Very fresh (under 5 min) — serve straight from the DB, no MCSR call at all
    if (now - Number(row.updated_at) < 300) {
      const saved = await db.execute({
        sql: 'SELECT raw FROM matches WHERE player_uuid = ? ORDER BY date DESC',
        args: [row.uuid],
      });
      const matches = saved.rows.map((r: any) => JSON.parse(r.raw));
      return res.json({ player: cachedPlayer, matches, cached: true });
    }

    // Older than 5 min — one cheap profile check to see if they played
    const profileRes = await fetch(`${MCSR_API}/users/${encodeURIComponent(username)}`);
    if (profileRes.ok) {
      const profileJson: any = await profileRes.json();
      const freshPlayer = profileJson.data;
      const cachedLastRanked = cachedPlayer.timestamp?.lastRanked ?? null;
      const freshLastRanked = freshPlayer.timestamp?.lastRanked ?? null;
      const cachedCount = cachedPlayer.statistics?.season?.playedMatches?.ranked ?? 0;
      const freshCount = freshPlayer.statistics?.season?.playedMatches?.ranked ?? 0;

      if (freshLastRanked === cachedLastRanked && freshCount === cachedCount) {
        // They haven't played since we last saved — refresh the timestamp
        // and serve the cached matches. No match list re-fetch needed.
        await db.execute({
          sql: `INSERT INTO players (uuid, nickname, elo, elo_rank, updated_at, raw)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(uuid) DO UPDATE SET
                  nickname = excluded.nickname,
                  elo = excluded.elo,
                  elo_rank = excluded.elo_rank,
                  updated_at = excluded.updated_at,
                  raw = excluded.raw`,
          args: [
            freshPlayer.uuid,
            freshPlayer.nickname,
            freshPlayer.eloRate,
            freshPlayer.eloRank,
            now,
            JSON.stringify(freshPlayer),
          ],
        });
        const saved = await db.execute({
          sql: 'SELECT raw FROM matches WHERE player_uuid = ? ORDER BY date DESC',
          args: [row.uuid],
        });
        const matches = saved.rows.map((r: any) => JSON.parse(r.raw));
        return res.json({ player: freshPlayer, matches, cached: true });
      }
      // They HAVE played — fall through to the full re-fetch below
    }
  }

  // Full fetch: player + all ranked matches (paged), save, return
  const playerRes = await fetch(`${MCSR_API}/users/${encodeURIComponent(username)}`);
  if (!playerRes.ok) {
    return res.status(404).json({ error: 'Player not found' });
  }
  const playerJson: any = await playerRes.json();
  const player = playerJson.data;

  let allMatches: any[] = [];
  let before: string | null = null;
  while (true) {
    const url = `${MCSR_API}/users/${player.uuid}/matches?type=2&count=100${before ? `&before=${before}` : ''}`;
    const mRes = await fetch(url);
    if (!mRes.ok) break;
    const mJson: any = await mRes.json();
    const page: any[] = mJson.data ?? [];
    if (page.length === 0) break;
    allMatches.push(...page);
    if (page.length < 100) break;
    before = page[page.length - 1].id;
  }

  const ranked = allMatches.filter((m) => !m.decayed);

  await db.execute({
    sql: `INSERT INTO players (uuid, nickname, elo, elo_rank, updated_at, raw)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(uuid) DO UPDATE SET
            nickname = excluded.nickname,
            elo = excluded.elo,
            elo_rank = excluded.elo_rank,
            updated_at = excluded.updated_at,
            raw = excluded.raw`,
    args: [player.uuid, player.nickname, player.eloRate, player.eloRank, now, JSON.stringify(player)],
  });

  await db.batch(
    ranked.map((m) => {
      const opponent = m.players.find((p: any) => p.uuid !== player.uuid);
      const change = (m.changes ?? []).find((c: any) => c.uuid === player.uuid);
      return {
        sql: `INSERT OR REPLACE INTO matches
              (match_id, player_uuid, opponent_uuid, opponent_nickname, result, seed_type, bastion_type, date, forfeited, elo_change, elo_after, raw)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          m.id,
          player.uuid,
          opponent?.uuid ?? null,
          opponent?.nickname ?? null,
          m.result?.uuid ?? null,
          m.seedType ?? null,
          m.bastionType ?? null,
          m.date,
          m.forfeited ? 1 : 0,
          change?.change ?? null,
          change?.eloRate ?? null,
          JSON.stringify(m),
        ],
      };
    })
  );


  return res.json({ player, matches: ranked, cached: false });
});


// Leaderboard, cached for 5 minutes
app.get('/api/leaderboard', async (_req, res) => {
  const now = Math.floor(Date.now() / 1000);
  const TTL = 300;

  const cached = await db.execute({
    sql: 'SELECT value, updated_at FROM cache WHERE key = ?',
    args: ['leaderboard'],
  });
  if (cached.rows.length > 0) {
    const row = cached.rows[0] as any;
    if (now - Number(row.updated_at) < TTL) {
      return res.json({ users: JSON.parse(row.value) });
    }
  }

  const r = await fetch(`${MCSR_API}/leaderboard`);
  if (!r.ok) return res.status(502).json({ error: 'Failed to fetch leaderboard' });
  const j: any = await r.json();
  const users = j.data.users;

  await db.execute({
    sql: `INSERT INTO cache (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: ['leaderboard', JSON.stringify(users), now],
  });
  return res.json({ users });
});

// Match detail, cached forever (a finished match never changes)
app.get('/api/matches/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid match id' });

  const cached = await db.execute({
    sql: 'SELECT raw FROM match_details WHERE match_id = ?',
    args: [id],
  });
  if (cached.rows.length > 0) {
    return res.json(JSON.parse((cached.rows[0] as any).raw));
  }

  const r = await fetch(`${MCSR_API}/matches/${id}`);
  if (!r.ok) return res.status(404).json({ error: 'Match not found' });
  const detail: any = await r.json();

  await db.execute({
    sql: 'INSERT OR REPLACE INTO match_details (match_id, raw) VALUES (?, ?)',
    args: [id, JSON.stringify(detail)],
  });
  return res.json(detail);
});

export default app;
