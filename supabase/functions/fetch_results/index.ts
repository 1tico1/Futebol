// Job: fetch_results — 1x/dia, 07h BRT, cobre os jogos da noite anterior
// (docs/tech-specs.md, seção 7). Atualiza placar/status/xG dos jogos finalizados.
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { withJobRun } from "../_shared/jobRun.ts";
import { COMPETITIONS, getFixturesByDateRange } from "../_shared/apiFootball.ts";
import { currentSeasonYear } from "../_shared/upsertRefs.ts";
import { mapFixtureStatus } from "../_shared/mapStatus.ts";

Deno.serve(async (_req) => {
  const client = getServiceClient();

  return await withJobRun(client, "fetch_results", async () => {
    const season = currentSeasonYear();
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    let updated = 0;

    for (const key of Object.keys(COMPETITIONS) as (keyof typeof COMPETITIONS)[]) {
      const comp = COMPETITIONS[key];
      // deno-lint-ignore no-explicit-any
      const fixtures = await getFixturesByDateRange(comp.externalId, season, yesterday, today) as any[];

      for (const fx of fixtures) {
        const status = mapFixtureStatus(fx.fixture.status?.short ?? "NS");
        if (status !== "finished") continue;

        const { error, count } = await client
          .from("matches")
          .update(
            {
              status,
              home_goals: fx.goals?.home ?? null,
              away_goals: fx.goals?.away ?? null,
            },
            { count: "exact" },
          )
          .eq("external_id", String(fx.fixture.id));

        if (error) throw error;
        updated += count ?? 0;
      }
    }

    return { updated, checkedRange: [yesterday, today] };
  });
});
