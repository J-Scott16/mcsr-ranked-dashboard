import { useState, useRef } from "react";
import "./App.css";



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
  changes: { uuid: string; change: number }[];
  seedType: string;
  bastionType: string | null;
  decayed: boolean;


};

type TypeStats = {
  played: number;
  wins: number;
  totalTime: number;
  finished: number;
};


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




export default function App() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const STEVE_HEAD = "https://minotar.net/avatar/MHF_Steve/100.png";
  const [matches, setMatches] = useState<Match[]>([]);

    const seedStats = player
    ? groupStats(matches, player.uuid, (m) =>
        m.seedType ? formatSeedType(m.seedType) : "Unknown"
      )
    : {};
  const bastionStats = player
    ? groupStats(matches, player.uuid, (m) =>
        m.bastionType ? formatSeedType(m.bastionType) : "Unknown"
      )
    : {};

  function loadPlayer(name: string) {
  setPlayer(null);
  setError(null);
  setLoading(true);
  setMatches([]);
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
                  <span>vs {opponent?.nickname}</span>
                  <span>{formatSeedType(match.seedType)}</span>
                  <span className="match-time">{timeLabel}</span>
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
          </div>
        </div>
      </div>
    )}
  </div>
);

}