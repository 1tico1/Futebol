import { createClient } from "@/lib/supabase/server";

export const revalidate = 0;

type Team = { name: string } | null;

type MatchRow = {
  id: number;
  kickoff_at: string;
  round: string | null;
  home_team: Team;
  away_team: Team;
};

type PredictionRow = {
  match_id: number;
  prob_home_win: number | null;
  prob_draw: number | null;
  prob_away_win: number | null;
  prob_over_2_5: number | null;
  prob_btts_yes: number | null;
  ai_context_summary: string | null;
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
        .select(
          "match_id, prob_home_win, prob_draw, prob_away_win, prob_over_2_5, prob_btts_yes, ai_context_summary, generated_at",
        )
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

  return (
    <main>
      <h1>Previsões de hoje</h1>

      {matchesError && <p className="error">Erro ao carregar jogos: {matchesError.message}</p>}
      {!matchesError && (matches ?? []).length === 0 && <p>Nenhum jogo hoje.</p>}

      <ul className="matches">
        {(matches ?? []).map((match) => {
          const prediction = latestPredictionByMatch.get(match.id);
          return (
            <li key={match.id} className="match-card">
              <div className="teams">
                {match.home_team?.name ?? "?"} x {match.away_team?.name ?? "?"}
              </div>
              {match.round && <div className="round">{match.round}</div>}

              {prediction ? (
                <div className="probs">
                  <span>Casa {formatPct(prediction.prob_home_win)}</span>
                  <span>Empate {formatPct(prediction.prob_draw)}</span>
                  <span>Fora {formatPct(prediction.prob_away_win)}</span>
                  <span>Over 2.5 {formatPct(prediction.prob_over_2_5)}</span>
                  <span>Ambas marcam {formatPct(prediction.prob_btts_yes)}</span>
                  {prediction.ai_context_summary && <p className="summary">{prediction.ai_context_summary}</p>}
                </div>
              ) : (
                <p className="no-prediction">Previsão ainda não gerada.</p>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
