import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProbabilityBar } from "@/components/ProbabilityBar";

export const revalidate = 0;

type Team = { name: string } | null;

type MatchRow = {
  id: number;
  kickoff_at: string;
  round: string | null;
  home_team: Team;
  away_team: Team;
};

type FinishedMatchRow = {
  id: number;
  kickoff_at: string;
  home_goals: number | null;
  away_goals: number | null;
  home_team: Team;
  away_team: Team;
};

type PredictionRow = {
  match_id: number;
  prob_home_win: number | null;
  prob_draw: number | null;
  prob_away_win: number | null;
  generated_at: string;
};

function formatPct(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(0)}%`;
}

export default async function HomePage() {
  const supabase = await createClient();

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const { data: matches, error: matchesError } = await supabase
    .from("matches")
    .select(
      "id, kickoff_at, round, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)",
    )
    .gte("kickoff_at", startOfDay.toISOString())
    .lt("kickoff_at", endOfDay.toISOString())
    .order("kickoff_at", { ascending: true })
    .returns<MatchRow[]>();

  const matchIds = (matches ?? []).map((m) => m.id);

  const { data: predictions } = matchIds.length
    ? await supabase
        .from("predictions")
        .select("match_id, prob_home_win, prob_draw, prob_away_win, generated_at")
        .in("match_id", matchIds)
        .order("generated_at", { ascending: false })
        .returns<PredictionRow[]>()
    : { data: [] as PredictionRow[] };

  const latestPredictionByMatch = new Map<number, PredictionRow>();
  for (const prediction of predictions ?? []) {
    if (!latestPredictionByMatch.has(prediction.match_id)) {
      latestPredictionByMatch.set(prediction.match_id, prediction);
    }
  }

  const { data: recentResults } = await supabase
    .from("matches")
    .select(
      "id, kickoff_at, home_goals, away_goals, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)",
    )
    .eq("status", "finished")
    .order("kickoff_at", { ascending: false })
    .limit(10)
    .returns<FinishedMatchRow[]>();

  return (
    <main>
      <h1>Previsões de hoje</h1>

      {matchesError && <p className="error">Erro ao carregar jogos: {matchesError.message}</p>}
      {!matchesError && (matches ?? []).length === 0 && <p className="no-prediction">Nenhum jogo hoje.</p>}

      <ul className="matches">
        {(matches ?? []).map((match) => {
          const prediction = latestPredictionByMatch.get(match.id);
          return (
            <li key={match.id} className="match-card">
              <Link href={`/partidas/${match.id}`} className="match-card-link">
                <div className="teams">
                  {match.home_team?.name ?? "?"} x {match.away_team?.name ?? "?"}
                </div>
                {match.round && <div className="round">{match.round}</div>}

                {prediction ? (
                  <ProbabilityBar
                    homeLabel={match.home_team?.name ?? "Casa"}
                    awayLabel={match.away_team?.name ?? "Fora"}
                    homePct={prediction.prob_home_win ?? 0}
                    drawPct={prediction.prob_draw ?? 0}
                    awayPct={prediction.prob_away_win ?? 0}
                  />
                ) : (
                  <p className="no-prediction">Previsão ainda não gerada.</p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      <h2 className="section-title">Últimos resultados</h2>
      {(recentResults ?? []).length === 0 ? (
        <p className="no-prediction">Sem resultados no banco ainda.</p>
      ) : (
        <ul className="results-list">
          {(recentResults ?? []).map((match) => (
            <li key={match.id}>
              <Link href={`/partidas/${match.id}`}>
                <span className="results-date">{new Date(match.kickoff_at).toLocaleDateString("pt-BR")}</span>
                <span className="results-score">
                  {match.home_team?.name ?? "?"} <b>{match.home_goals}-{match.away_goals}</b>{" "}
                  {match.away_team?.name ?? "?"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
