// Job: generate_prediction — 24h antes do kickoff + atualização 2h antes
// (docs/tech-specs.md, seção 7). Cron dispara a cada hora; a função escolhe
// os jogos que caem em uma dessas duas janelas.
//
// Fluxo (docs/architecture.md, seções 2 e 5): o worker Python calcula a
// matriz de probabilidade Dixon-Coles (determinística); a Claude API só
// entra depois, para resumir contexto qualitativo e propor ajustes
// pequenos e auditáveis — nunca para "inventar" a probabilidade.
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { withJobRun } from "../_shared/jobRun.ts";

const WINDOW_24H = { from: 23, to: 25 }; // horas antes do kickoff
const WINDOW_2H = { from: 0, to: 2 };

Deno.serve(async (_req) => {
  const client = getServiceClient();

  return await withJobRun(client, "generate_prediction", async () => {
    const workerUrl = Deno.env.get("MODEL_WORKER_URL");
    const workerSecret = Deno.env.get("MODEL_WORKER_SHARED_SECRET");
    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    const claudeModel = Deno.env.get("CLAUDE_MODEL") ?? "claude-sonnet-5";
    if (!workerUrl || !workerSecret) throw new Error("MODEL_WORKER_URL / MODEL_WORKER_SHARED_SECRET não configurados");
    if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY não configurada");

    const now = Date.now();
    const inWindow = (hoursFrom: number, hoursTo: number) => ({
      gte: new Date(now + hoursFrom * 60 * 60 * 1000).toISOString(),
      lte: new Date(now + hoursTo * 60 * 60 * 1000).toISOString(),
    });

    const w24 = inWindow(WINDOW_24H.from, WINDOW_24H.to);
    const w2 = inWindow(WINDOW_2H.from, WINDOW_2H.to);

    const { data: matches, error } = await client
      .from("matches")
      .select("id, external_id, home_team_id, away_team_id, kickoff_at, season_id, seasons(competition_id)")
      .eq("status", "scheduled")
      .or(
        `and(kickoff_at.gte.${w24.gte},kickoff_at.lte.${w24.lte}),and(kickoff_at.gte.${w2.gte},kickoff_at.lte.${w2.lte})`,
      );
    if (error) throw error;

    let generated = 0;

    for (const match of matches ?? []) {
      // deno-lint-ignore no-explicit-any
      const competitionId = (match as any).seasons?.competition_id;

      const { data: modelRun } = await client
        .from("model_runs")
        .select("id")
        .eq("competition_id", competitionId)
        .order("trained_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!modelRun) continue; // ainda não há treino para essa competição

      const workerRes = await fetch(`${workerUrl}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Worker-Secret": workerSecret },
        body: JSON.stringify({ match_id: match.id, model_run_id: modelRun.id }),
      });
      if (!workerRes.ok) throw new Error(`worker /predict falhou: ${workerRes.status} ${await workerRes.text()}`);
      const stats = await workerRes.json();

      const { data: lineups } = await client
        .from("match_lineups")
        .select("player_name, status, team_id")
        .eq("match_id", match.id)
        .in("status", ["out_injury", "out_suspension", "doubtful"]);

      const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: claudeModel,
          max_tokens: 700,
          system:
            "Você resume dados estruturados de uma partida de futebol e propõe pequenos ajustes contextuais " +
            "auditáveis sobre um modelo estatístico já calculado. NUNCA gere ou altere probabilidades diretamente " +
            "— responda em JSON com as chaves `context_summary` (texto curto) e `adjustments` (lista de objetos " +
            "{multiplier_target, multiplier, reason}, vazio se nada relevante). Baseie-se só no que está no input.",
          messages: [
            {
              role: "user",
              content: JSON.stringify({ model_stats: stats, absences: lineups ?? [] }),
            },
          ],
        }),
      });
      if (!claudeRes.ok) throw new Error(`Claude API falhou: ${claudeRes.status} ${await claudeRes.text()}`);
      const claudeJson = await claudeRes.json();
      const text = claudeJson.content?.[0]?.text ?? "{}";
      let aiParsed: { context_summary?: string; adjustments?: unknown } = {};
      try {
        aiParsed = JSON.parse(text);
      } catch {
        aiParsed = { context_summary: text, adjustments: [] };
      }

      const { error: insertErr } = await client.from("predictions").insert({
        match_id: match.id,
        model_run_id: modelRun.id,
        prob_home_win: stats.prob_home_win,
        prob_draw: stats.prob_draw,
        prob_away_win: stats.prob_away_win,
        prob_btts_yes: stats.prob_btts_yes,
        prob_over_2_5: stats.prob_over_2_5,
        exact_score_probs: stats.exact_score_probs,
        ai_context_summary: aiParsed.context_summary ?? null,
        ai_adjustments: aiParsed.adjustments ?? [],
      });
      if (insertErr) throw insertErr;
      generated += 1;
    }

    return { generated, matchesChecked: matches?.length ?? 0 };
  });
});
