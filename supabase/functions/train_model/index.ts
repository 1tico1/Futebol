// Job: train_model — 1x/dia, madrugada, ou logo após o fim de cada rodada
// (docs/tech-specs.md, seção 7). Só dispara o treino no worker Python — o
// ajuste dos parâmetros Dixon-Coles (scipy/numpy) não roda em Deno, então
// esta função é uma ponte HTTP fina até o serviço Python (ver worker/).
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { withJobRun } from "../_shared/jobRun.ts";
import { COMPETITIONS } from "../_shared/apiFootball.ts";
import { currentSeasonYear } from "../_shared/upsertRefs.ts";

Deno.serve(async (_req) => {
  const client = getServiceClient();

  return await withJobRun(client, "train_model", async () => {
    const workerUrl = Deno.env.get("MODEL_WORKER_URL");
    const workerSecret = Deno.env.get("MODEL_WORKER_SHARED_SECRET");
    if (!workerUrl || !workerSecret) {
      throw new Error("MODEL_WORKER_URL / MODEL_WORKER_SHARED_SECRET não configurados");
    }

    const season = currentSeasonYear();
    const results: Record<string, unknown> = {};

    for (const key of Object.keys(COMPETITIONS) as (keyof typeof COMPETITIONS)[]) {
      const comp = COMPETITIONS[key];
      const res = await fetch(`${workerUrl}/train`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Worker-Secret": workerSecret,
        },
        body: JSON.stringify({ competition_external_id: comp.externalId, season }),
      });

      if (!res.ok) {
        throw new Error(`worker /train falhou para ${key}: ${res.status} ${await res.text()}`);
      }
      results[key] = await res.json();
    }

    return { season, results };
  });
});
