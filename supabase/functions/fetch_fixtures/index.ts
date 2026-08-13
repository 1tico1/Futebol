// Job: fetch_fixtures — 1x/dia, 03h BRT (docs/tech-specs.md, seção 7).
// Puxa os jogos dos próximos 14 dias de Brasileirão + Libertadores e faz
// upsert em `matches` (e das entidades de referência que ainda não existirem).
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { withJobRun } from "../_shared/jobRun.ts";
import { COMPETITIONS, getFixturesByDateRange } from "../_shared/apiFootball.ts";
import { upsertCompetition, upsertSeason, upsertTeam, currentSeasonYear } from "../_shared/upsertRefs.ts";
import { mapFixtureStatus } from "../_shared/mapStatus.ts";

Deno.serve(async (_req) => {
  const client = getServiceClient();

  return await withJobRun(client, "fetch_fixtures", async () => {
    const season = currentSeasonYear();
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    let upserted = 0;

    for (const key of Object.keys(COMPETITIONS) as (keyof typeof COMPETITIONS)[]) {
      const competitionId = await upsertCompetition(client, key);
      const seasonId = await upsertSeason(client, competitionId, season);
      const comp = COMPETITIONS[key];

      // deno-lint-ignore no-explicit-any
      const fixtures = await getFixturesByDateRange(comp.externalId, season, from, to) as any[];

      for (const fx of fixtures) {
        const homeTeamId = await upsertTeam(client, fx.teams.home.id, fx.teams.home.name);
        const awayTeamId = await upsertTeam(client, fx.teams.away.id, fx.teams.away.name);

        const { error } = await client.from("matches").upsert(
          {
            external_id: String(fx.fixture.id),
            season_id: seasonId,
            round: fx.league?.round ?? null,
            stage: comp.tier === "knockout" ? "knockout_leg1" : "regular",
            home_team_id: homeTeamId,
            away_team_id: awayTeamId,
            kickoff_at: fx.fixture.date,
            status: mapFixtureStatus(fx.fixture.status?.short ?? "NS"),
            venue: fx.fixture.venue?.name ?? null,
          },
          { onConflict: "external_id" },
        );
        if (error) throw error;
        upserted += 1;
      }
    }

    return { upserted, from, to, season };
  });
});
