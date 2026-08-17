import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecentForm, getHeadToHead } from "@/lib/supabase/queries";
import { ProbabilityBar } from "@/components/ProbabilityBar";
import { ScoreMatrix } from "@/components/ScoreMatrix";
import { FormBadges } from "@/components/FormBadges";
import { StatTile } from "@/components/StatTile";

export const revalidate = 0;

type TeamJoin = { name: string } | null;

type MatchDetail = {
  id: number;
  kickoff_at: string;
  round: string | null;
  status: string;
  home_team_id: number;
  away_team_id: number;
  home_goals: number | null;
  away_goals: number | null;
  home_team: TeamJoin;
  away_team: TeamJoin;
  season: { year: number; competition: { name: string } | null } | null;
};

type Prediction = {
  prob_home_win: number | null;
  prob_draw: number | null;
  prob_away_win: number | null;
  prob_btts_yes: number | null;
  prob_over_2_5: number | null;
  exact_score_probs: Record<string, number> | null;
  ai_context_summary: string | null;
  ai_adjustments: { reason?: string; multiplier_target?: string; multiplier?: number }[] | null;
};

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: match } = await supabase
    .from("matches")
    .select(
      "id, kickoff_at, round, status, home_goals, away_goals, home_team_id, away_team_id, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name), season:seasons(year, competition:competitions(name))",
    )
    .eq("id", id)
    .maybeSingle<MatchDetail>();

  if (!match) notFound();

  const { data: prediction } = await supabase
    .from("predictions")
    .select("prob_home_win, prob_draw, prob_away_win, prob_btts_yes, prob_over_2_5, exact_score_probs, ai_context_summary, ai_adjustments")
    .eq("match_id", id)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle<Prediction>();

  const [homeForm, awayForm, h2h] = await Promise.all([
    getRecentForm(supabase, match.home_team_id, match.id),
    getRecentForm(supabase, match.away_team_id, match.id),
    getHeadToHead(supabase, match.home_team_id, match.away_team_id),
  ]);

  const homeName = match.home_team?.name ?? "Casa";
  const awayName = match.away_team?.name ?? "Fora";

  return (
    <main>
      <a href="/" className="back-link">
        ← Voltar
      </a>

      <header className="match-header">
        <div className="competition-tag">
          {match.season?.competition?.name ?? "Competição"} · {match.season?.year ?? ""}
          {match.round ? ` · ${match.round}` : ""}
        </div>
        <h1>
          {homeName} <span className="vs">x</span> {awayName}
        </h1>
        <div className="kickoff">
          {new Date(match.kickoff_at).toLocaleString("pt-BR", { dateStyle: "full", timeStyle: "short" })}
        </div>
        {match.status === "finished" && (
          <div className="final-score">
            Resultado final: {match.home_goals} - {match.away_goals}
          </div>
        )}
      </header>

      {prediction ? (
        <>
          <section className="panel">
            <h2>Probabilidades — 1x2</h2>
            <ProbabilityBar
              homeLabel={homeName}
              awayLabel={awayName}
              homePct={prediction.prob_home_win ?? 0}
              drawPct={prediction.prob_draw ?? 0}
              awayPct={prediction.prob_away_win ?? 0}
            />
          </section>

          <section className="panel stat-tiles">
            <StatTile label="Ambas marcam" value={`${Math.round((prediction.prob_btts_yes ?? 0) * 100)}%`} />
            <StatTile label="Over 2.5 gols" value={`${Math.round((prediction.prob_over_2_5 ?? 0) * 100)}%`} />
          </section>

          {prediction.exact_score_probs && Object.keys(prediction.exact_score_probs).length > 0 && (
            <section className="panel">
              <h2>Matriz de placar exato</h2>
              <ScoreMatrix scores={prediction.exact_score_probs} />
            </section>
          )}

          {prediction.ai_context_summary && (
            <section className="panel ai-panel">
              <h2>Contexto (IA)</h2>
              <p>{prediction.ai_context_summary}</p>
              {Array.isArray(prediction.ai_adjustments) && prediction.ai_adjustments.length > 0 && (
                <ul className="ai-adjustments">
                  {prediction.ai_adjustments.map((adj, i) => (
                    <li key={i}>{adj.reason ?? `${adj.multiplier_target}: ${adj.multiplier}`}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      ) : (
        <section className="panel">
          <p className="no-prediction">
            Previsão ainda não gerada pelo modelo estatístico pra essa partida.
          </p>
        </section>
      )}

      <section className="panel two-col">
        <div>
          <h2>Forma recente — {homeName}</h2>
          <FormBadges items={homeForm} />
        </div>
        <div>
          <h2>Forma recente — {awayName}</h2>
          <FormBadges items={awayForm} />
        </div>
      </section>

      <section className="panel">
        <h2>Confrontos diretos</h2>
        {h2h.length === 0 ? (
          <p className="no-prediction">Sem confrontos recentes registrados.</p>
        ) : (
          <ul className="h2h-list">
            {h2h.map((m) => (
              <li key={m.id}>
                <span className="h2h-date">{new Date(m.kickoff_at).toLocaleDateString("pt-BR")}</span>
                <span>
                  {m.home_team?.name} {m.home_goals}-{m.away_goals} {m.away_team?.name}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
