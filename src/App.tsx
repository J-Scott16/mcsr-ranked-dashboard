import { useState, useRef, useEffect } from "react";
import "./App.css";
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';




type Player = {
  nickname: string;
  eloRate: number | null;
  eloRank: number | null;
  uuid: string;
};
type Match = {
  id: number;
  date: number;
  players: { uuid: string; nickname: string }[];
  result: { uuid: string; time: number } | null;
  forfeited: boolean;
  seedType: string;
  bastionType: string | null;
  decayed: boolean;
  changes: { uuid: string; change: number | null; eloRate: number | null }[];



};

type TypeStats = {
  played: number;
  wins: number;
  totalTime: number;
  finished: number;
};

type MatchSplits = {
  matchId: number;
  myOverworldMs: number | null;
  myBastionMs: number | null;
  oppOverworldMs: number | null;
  oppBastionMs: number | null;
};

function rankColor(elo: number): string {
  if (elo >= 2000) return '#a855f7'; // Netherite
  if (elo >= 1500) return '#38bdf8'; // Diamond
  if (elo >= 1200) return '#22c55e'; // Emerald
  if (elo >= 900) return '#facc15';  // Gold
  if (elo >= 600) return '#d1d5db';  // Iron
  return '#6b7280'; // Coal
}


function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatSeedType(seedType: string | null | undefined): string {
  if (!seedType) return "Unknown";
  return seedType
    .toLowerCase()
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatDiff(ms: number): string {
  const sign = ms >= 0 ? "+" : "-";
  return `${sign}${(Math.abs(ms) / 1000).toFixed(1)}s`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function EloTooltip({ active, payload }: any) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload;
  return (
    <div style={{ background: '#1a1d27', border: '1px solid #2a2e3a', borderRadius: '8px', padding: '8px 12px', color: '#e8e8e8' }}>
      <div style={{ fontWeight: 700 }}>{point.rank}</div>
      <div style={{ color: '#8a8fa3', fontSize: 14 }}>Elo: {point.elo}</div>
      <div style={{ color: '#8a8fa3', fontSize: 14 }}>
        {point.ago === 'now' ? 'just now' : `${point.ago} ago`}
      </div>
    </div>
  );
}


function timeAgo(dateSeconds: number): string {
  const seconds = Math.floor(Date.now() / 1000) - dateSeconds;
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(days / 365);
  return `${years}y`;
}


type EloPoint = { match: number; elo: number; rank: string; ago: string };



function buildEloHistory(matches: Match[], playerUuid: string): EloPoint[] {
  const points: EloPoint[] = [];
  // matches come back newest-first, so reverse to go oldest -> newest
  const chronological = [...matches].reverse();
  chronological.forEach((m, i) => {
    const entry = m.changes?.find((c) => c.uuid === playerUuid);
    const elo = entry?.eloRate;
    if (elo == null) return; // placement match, no rating yet
    points.push({ match: i + 1, elo, rank: eloToRank(elo), ago: timeAgo(m.date) });

  });
  return points;
}

function eloToRank(elo: number): string {
  if (elo >= 2000) return 'Netherite';
  if (elo >= 1800) return 'Diamond III';
  if (elo >= 1650) return 'Diamond II';
  if (elo >= 1500) return 'Diamond I';
  if (elo >= 1400) return 'Emerald III';
  if (elo >= 1300) return 'Emerald II';
  if (elo >= 1200) return 'Emerald I';
  if (elo >= 1100) return 'Gold III';
  if (elo >= 1000) return 'Gold II';
  if (elo >= 900) return 'Gold I';
  if (elo >= 800) return 'Iron III';
  if (elo >= 700) return 'Iron II';
  if (elo >= 600) return 'Iron I';
  if (elo >= 500) return 'Coal III';
  if (elo >= 400) return 'Coal II';
  return 'Coal I';
}



function groupStats(
  matches: Match[],
  playerUuid: string,
  getKey: (match: Match) => string
): Record<string, TypeStats> {
  const stats: Record<string, TypeStats> = {};
  for (const match of matches) {
    if (!match.result?.uuid) continue;
    const key = getKey(match);
    if (!stats[key]) {
      stats[key] = { played: 0, wins: 0, totalTime: 0, finished: 0 };
    }
    stats[key].played += 1;
    if (match.result?.uuid === playerUuid) {
      stats[key].wins += 1;
    }
    if (match.result && !match.forfeited) {
      stats[key].totalTime += match.result.time;
      stats[key].finished += 1;
    }
  }
  return stats;
}


async function fetchAllMatches(name: string): Promise<Match[]> {
  const all: Match[] = [];
  let before: number | null = null;
  let pages = 0;
  while (pages < 10) {
    const url =
      before === null
        ? `https://api.mcsrranked.com/users/${name}/matches?type=2&count=100`
        : `https://api.mcsrranked.com/users/${name}/matches?type=2&count=100&before=${before}`;
    const res = await fetch(url);
    const json = await res.json();
    if (json.status !== "success") break;
    const page: Match[] = json.data;
    console.log(`page ${pages + 1}: got ${page.length} matches`);
    all.push(...page);
    pages += 1;
    if (page.length < 100) break;
    before = page[page.length - 1].id;
  }
  return all;
}

async function fetchMatchSplits(matchId: number, playerUuid: string, opponentUuid: string): Promise<MatchSplits> {
  const res = await fetch(`https://api.mcsrranked.com/matches/${matchId}`);
  const json = await res.json();
  const timelines = (json.data.timelines ?? []) as { uuid: string; time: number; type: string }[];
  const mine = timelines.filter((t) => t.uuid === playerUuid);
  const theirs = timelines.filter((t) => t.uuid === opponentUuid);
  const myEnterNether = mine.find((t) => t.type === "story.enter_the_nether")?.time ?? null;
  const oppEnterNether = theirs.find((t) => t.type === "story.enter_the_nether")?.time ?? null;
  const myFindBastion = mine.find((t) => t.type === "nether.find_bastion")?.time ?? null;
  const myFindFortress = mine.find((t) => t.type === "nether.find_fortress")?.time ?? null;
  const oppFindBastion = theirs.find((t) => t.type === "nether.find_bastion")?.time ?? null;
  const oppFindFortress = theirs.find((t) => t.type === "nether.find_fortress")?.time ?? null;
  return {
    matchId,
    myOverworldMs: myEnterNether,
    myBastionMs: myFindBastion !== null && myFindFortress !== null ? myFindFortress - myFindBastion : null,
    oppOverworldMs: oppEnterNether,
    oppBastionMs: oppFindBastion !== null && oppFindFortress !== null ? oppFindFortress - oppFindBastion : null,
  };
}

type SplitTotal = { totalMs: number; count: number; diffs: number[] };

function eloGradientStops(min: number, max: number): { offset: string; color: string }[] {
  if (max <= min) return [{ offset: '0%', color: rankColor(max) }, { offset: '100%', color: rankColor(max) }];
  const thresholds = [2000, 1500, 1200, 900, 600];
  const stops: { offset: string; color: string }[] = [];
  let color = rankColor(max);
  stops.push({ offset: '0%', color });
  for (const t of thresholds) {
    if (t <= min || t >= max) continue;
    const pct = `${(((max - t) / (max - min)) * 100).toFixed(2)}%`;
    stops.push({ offset: pct, color });
    color = rankColor(t - 1);
    stops.push({ offset: pct, color });
  }
  stops.push({ offset: '100%', color });
  return stops;
}


const overworldKeys = ["buried_Treasure", "desert_Temple", "village", "ruined_Portal", "shipwreck"] as const;
const bastionKeys = ["housing", "treasure", "stables", "bridge"] as const;


type AllSplits = {
  buried_Treasure: SplitTotal;
  desert_Temple: SplitTotal;
  village: SplitTotal;
  ruined_Portal: SplitTotal;
  shipwreck: SplitTotal;
  housing: SplitTotal;
  treasure: SplitTotal;
  stables: SplitTotal;
  bridge: SplitTotal;
};

const seedKeyMap: Record<string, keyof AllSplits> = {
  BURIED_TREASURE: "buried_Treasure",
  DESERT_TEMPLE: "desert_Temple",
  VILLAGE: "village",
  RUINED_PORTAL: "ruined_Portal",
  SHIPWRECK: "shipwreck",
};
const bastionKeyMap: Record<string, keyof AllSplits> = {
  HOUSING: "housing",
  TREASURE: "treasure",
  STABLES: "stables",
  BRIDGE: "bridge",
};

type LeaderboardPlayer = {
  uuid: string;
  nickname: string;
  eloRate: number | null;
  eloRank: number | null;
};

async function fetchLeaderboard(): Promise<LeaderboardPlayer[]> {
  const res = await fetch("https://api.mcsrranked.com/leaderboard");
  const json = await res.json();
  if (json.status !== "success") return [];
  return (json.data.users as LeaderboardPlayer[]).slice(0, 20);
}



async function fetchAllMatchSplits(matches: Match[], playerUuid: string): Promise<AllSplits> {
  const splits: AllSplits = {
    buried_Treasure: { totalMs: 0, count: 0, diffs: []},
    desert_Temple: { totalMs: 0, count: 0, diffs: []},
    village: { totalMs: 0, count: 0, diffs: []},
    ruined_Portal: { totalMs: 0, count: 0, diffs: []},
    shipwreck: { totalMs: 0, count: 0, diffs: []},
    housing: { totalMs: 0, count: 0, diffs: []},
    treasure: { totalMs: 0, count: 0, diffs: []},
    stables: { totalMs: 0, count: 0, diffs: []},
    bridge: { totalMs: 0, count: 0, diffs: []},
  };

  for (const match of matches.slice(0, 100)) {
    const opponent = match.players.find((p) => p.uuid !== playerUuid);
    const matchSplit = await fetchMatchSplits(match.id, playerUuid, opponent?.uuid ?? "");
    if (matchSplit.myOverworldMs !== null && match.seedType) {
      const key = seedKeyMap[match.seedType];
      if (key) {
        const bucket = splits[key];
        bucket.totalMs += matchSplit.myOverworldMs;
        bucket.count += 1;
        if (matchSplit.oppOverworldMs !== null) {
          bucket.diffs.push(matchSplit.myOverworldMs - matchSplit.oppOverworldMs);
        }
      }
    }

    if (matchSplit.myBastionMs !== null && match.bastionType) {
      const key = bastionKeyMap[match.bastionType];
      if (key) {
        const bucket = splits[key];
        bucket.totalMs += matchSplit.myBastionMs;
        bucket.count += 1;
        if (matchSplit.oppBastionMs !== null) {
          bucket.diffs.push(matchSplit.myBastionMs - matchSplit.oppBastionMs);
        }
      }
    }
  }
  return splits;
}




export default function App() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const STEVE_HEAD = "https://minotar.net/avatar/MHF_Steve/100.png";
  const [matches, setMatches] = useState<Match[]>([]);
  const [splits, setSplits] = useState<AllSplits | null>(null);

  useEffect(() => {
    if (!player || matches.length === 0) return;
    fetchAllMatchSplits(matches, player.uuid).then(setSplits);
  }, [player, matches]);

  const [leaderboard, setLeaderboard] = useState<LeaderboardPlayer[]>([]);

 useEffect(() => {
  fetchLeaderboard().then(setLeaderboard).catch((e) => console.error(e));
}, []);



  const seedStats = player
    ? groupStats(matches, player.uuid, (m) =>
        m.seedType ? formatSeedType(m.seedType) : "Unknown"
      )
    : {};

  const wins = player ? matches.filter((m) => m.result?.uuid === player.uuid).length : 0;
  const decisive = matches.filter((m) => m.result?.uuid).length;
  const forfeits = player
    ? matches.filter((m) => m.forfeited && m.result?.uuid && m.result.uuid !== player.uuid).length
    : 0;
  const winRate = decisive > 0 ? Math.round((wins / decisive) * 100) : 0;
  const forfeitRate = matches.length > 0 ? Math.round((forfeits / matches.length) * 100) : 0;

  const bastionStats = player
    ? groupStats(matches, player.uuid, (m) =>
        m.bastionType ? formatSeedType(m.bastionType) : "Unknown"
      )
    : {};
    
const eloHistory = player && matches.length > 0 ? buildEloHistory(matches, player.uuid) : [];
const elos = eloHistory.map((p) => p.elo);
const dataMin = elos.length ? Math.min(...elos) : 0;
const dataMax = elos.length ? Math.max(...elos) : 0;
const lowTick = Math.floor(dataMin / 100) * 100;
const highTick = Math.ceil(dataMax / 100) * 100;
const yTicks: number[] = [];
for (let t = lowTick; t <= highTick; t += 100) yTicks.push(t);
const gradientStops = eloHistory.length > 0 ? eloGradientStops(dataMin, dataMax) : [];



  function loadPlayer(name: string) {
  setPlayer(null);
  setError(null);
  setLoading(true);
  setMatches([]);
  setSplits(null);

  fetch(`https://api.mcsrranked.com/users/${name}`)
    .then((res) => res.json())
    .then((json) => {
      if (json.status === "success") {
        setPlayer(json.data);
      } else {
        setError(JSON.stringify(json.data));
      }
    })
    .catch((e) => setError(String(e)))
    .finally(() => setLoading(false));

  fetchAllMatches(name)
  .then((all) => setMatches(all.filter((m) => !m.decayed)))
  .catch(() => {});


  }

return (
  <div className="container">

    <div className="page-layout">
      <div className="leaderboard">
        <h3>Leaderboard</h3>
        {leaderboard.length === 0 && <p>Loading...</p>}
        {leaderboard.map((p) => (
          <button
            key={p.uuid}
            className="leaderboard-row"
            onClick={() => {
              if (inputRef.current) inputRef.current.value = p.nickname;
              loadPlayer(p.nickname);
            }}
          >
            <span>#{p.eloRank} {p.nickname}</span>
            <span>{p.eloRate}</span>
          </button>
        ))}
      </div>

      <div className="main-content">
        <form
      className="search-row"
      onSubmit={(e) => {
        e.preventDefault();
        const name = inputRef.current?.value.trim();
        if (name) loadPlayer(name);
      }}
    >
      <input ref={inputRef} placeholder="Search a player" />
      <button type="submit">Search</button>
    </form>
        {error && <p>{error}</p>}
        {loading && <p>Loading...</p>}
        {player && (
          <div className="card">
            <h2 className="player-name">{player.nickname}</h2>
          <div className="player-head-row">
            <div className="head-stat">
              <span className="stat-label">Win Rate</span>
              <span className="stat-value">{winRate}%</span>
              <span className="stat-sub">{wins}/{decisive}</span>
            </div>
            <div className="player-head">
              <img
                className="player-head-img"
                src={`https://minotar.net/avatar/${player.uuid}/100.png`}
                alt={`${player.nickname}'s head`}
                onError={(e) => {
                  e.currentTarget.onerror = null;
                  e.currentTarget.src = STEVE_HEAD;
                }}
              />
              <img
                className="player-head-img"
                src={`https://minotar.net/helm/${player.uuid}/100.png`}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            </div>
            <div className="head-stat">
              <span className="stat-label">Forfeit Rate</span>
              <span className="stat-value">{forfeitRate}%</span>
              <span className="stat-sub">{forfeits}/{matches.length}</span>
            </div>
          </div>

          <div className="stats">
            <div className="stat">
              <span className="stat-label">Elo</span>
              <span className="stat-value">{player.eloRate}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Rank</span>
              <span className="stat-value">#{player.eloRank}</span>
            </div>
          </div>

          <div className="content-row">
            <div className="type-panel">
              <h3>Seed Types</h3>
              {Object.entries(seedStats).map(([name, s]) => (
                <div key={name} className="type-row">
                  <span>{name}</span>
                  <span>
                    {s.wins}/{s.played} · {Math.round((s.wins / s.played) * 100)}% · avg{" "}
                    {s.finished > 0 ? formatTime(s.totalTime / s.finished) : "—"}
                  </span>
                </div>
              ))}
              {splits && (
                <div className="split-block">
                  <h3>Overworld Splits</h3>
                  {overworldKeys.map((key) => {
                    const s = splits[key];
                    const medDiff = median(s.diffs);
                    return (
                      <div key={key} className="type-row">
                        <span>{formatSeedType(key)}</span>
                        <span>
                          <span className="split-time">{s.count > 0 ? formatTime(s.totalMs / s.count) : "—"}</span>
                          {medDiff !== null && (
                            <span className={`split-diff ${medDiff <= 0 ? "win" : "loss"}`}>{formatDiff(medDiff)}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="matches">
              {matches.slice(0, 20).map((match) => {
                const opponent = match.players.find(
                  (p) => p.uuid !== player.uuid
                );
                const won = match.result?.uuid === player.uuid;
                const timeLabel = match.forfeited
                  ? "Forfeit"
                  : match.result?.uuid
                    ? formatTime(match.result.time)
                    : "Draw";
                return (
                  <div key={match.id} className="match-row">
                    <span className={won ? "win" : "loss"}>
                      {won ? "Win" : "Loss"}
                    </span>
                    <span className="match-opponent">vs {opponent?.nickname}</span>
                    <span>{formatSeedType(match.seedType)}</span>
                    <span className="match-time">{timeLabel}</span>
                    <span className="match-age">{timeAgo(match.date)}</span>
                  </div>
                );
              })}
            </div>

            <div className="type-panel">
              <h3>Bastion Types</h3>
              {Object.entries(bastionStats).map(([name, s]) => (
                <div key={name} className="type-row">
                  <span>{name}</span>
                  <span>
                    {s.wins}/{s.played} · {Math.round((s.wins / s.played) * 100)}%
                  </span>
                </div>
              ))}
              {splits && (
                <div className="split-block">
                  <h3>Bastion Splits</h3>
                  {bastionKeys.map((key) => {
                    const s = splits[key];
                    const medDiff = median(s.diffs);
                    return (
                      <div key={key} className="type-row">
                        <span>{formatSeedType(key)}</span>
                        <span>
                          <span className="split-time">{s.count > 0 ? formatTime(s.totalMs / s.count) : "—"}</span>
                          {medDiff !== null && (
                            <span className={`split-diff ${medDiff <= 0 ? "win" : "loss"}`}>{formatDiff(medDiff)}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {eloHistory.length > 0 && (
            <div className="elo-chart">
              <h3>Elo History</h3>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={eloHistory}>
                  <defs>
                    <linearGradient id="eloLine" x1="0" y1="0" x2="0" y2="1">
                      {gradientStops.map((s, i) => (
                        <stop key={i} offset={s.offset} stopColor={s.color} />
                      ))}
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#2a2e3a" />
                  <XAxis dataKey="match" stroke="#8a8fa3" tick={{ fontSize: 12 }} />
                  <YAxis domain={[lowTick, highTick]} ticks={yTicks} stroke="#8a8fa3" tick={{ fontSize: 12 }} />
                  <Tooltip content={<EloTooltip />} />
                  <Line type="monotone" dataKey="elo" stroke="url(#eloLine)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>

            </div>
          )}
        </div>
      )}
    </div>
  </div>
</div>
  );
}