// Job: fetch_lineups_injuries — cron dispara a cada hora; a função decide a
// cadência real: lineup confirmada é buscada para qualquer jogo nas
// próximas 6h (equivale a "1x/hora perto do kickoff"), enquanto o scan
// mais amplo de lesões/desfalques (mais caro e menos volátil) só roda a
// cada 6h. Ver docs/tech-specs.md, seção 7.
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { withJobRun } from "../_shared/jobRun.ts";
import { COMPETITIONS, getFixtureLineups, getInjuries } from "../_shared/apiFootball.ts";
import { currentSeasonYear } from "../_shared/upsertRefs.ts";

const NEAR_KICKOFF_WINDOW_MS = 6 * 60 * 60 * 1000;
const WIDE_SCAN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

Deno.serve(async (_req) => {
  const client = getServiceClient();

  return await withJobRun(client, "fetch_lineups_injuries", async () => {
    const now = new Date();
    const runWideScan = now.getUTCHours() % 6 === 0;

    // --- Escalações confirmadas: só faz sentido perto do kickoff ---
    const { data: nearMatches, error: nearErr } = await client
      .from("matches")
      .select("id, external_id, home_team_id, away_team_id")
      .eq("status", "scheduled")
      .gte("kickoff_at", now.toISOString())
      .lte("kickoff_at", new Date(now.getTime() + NEAR_KICKOFF_WINDOW_MS).toISOString());
    if (nearErr) throw nearErr;

    let lineupsUpserted = 0;
    for (const match of nearMatches ?? []) {
      // deno-lint-ignore no-explicit-any
      const lineups = await getFixtureLineups(match.external_id) as any[];
      for (const teamLineup of lineups) {
        const teamId =
          String(teamLineup.team.id) === String(match.home_team_id) ? match.home_team_id : match.away_team_id;

        const rows = [
          ...(teamLineup.startXI ?? []).map((p: { player: { name: string } }) => ({
            match_id: match.id,
            team_id: teamId,
            player_name: p.player.name,
            status: "starting",
          })),
          ...(teamLineup.substitutes ?? []).map((p: { player: { name: string } }) => ({
            match_id: match.id,
            team_id: teamId,
            player_name: p.player.name,
            status: "bench",
          })),
        ];
        if (rows.length === 0) continue;

        const { error } = await client.from("match_lineups").insert(rows);
        if (error) throw error;
        lineupsUpserted += rows.length;
      }
    }

    // --- Desfalques (lesão/suspensão): scan mais amplo, mais barato de cachear ---
    let injuriesUpserted = 0;
    if (runWideScan) {
      const season = currentSeasonYear();
      const { data: upcomingMatches, error: upErr } = await client
        .from("matches")
        .select("id, home_team_id, away_team_id, kickoff_at")
        .eq("status", "scheduled")
        .gte("kickoff_at", now.toISOString())
        .lte("kickoff_at", new Date(now.getTime() + WIDE_SCAN_WINDOW_MS).toISOString());
      if (upErr) throw upErr;

      for (const key of Object.keys(COMPETITIONS) as (keyof typeof COMPETITIONS)[]) {
        const comp = COMPETITIONS[key];
        // deno-lint-ignore no-explicit-any
        const injuries = await getInjuries(comp.externalId, season) as any[];

        for (const inj of injuries) {
          const affectedMatches = (upcomingMatches ?? []).filter(
            (m) => String(m.home_team_id) === String(inj.team.id) || String(m.away_team_id) === String(inj.team.id),
          );
          for (const match of affectedMatches) {
            const teamId = String(match.home_team_id) === String(inj.team.id) ? match.home_team_id : match.away_team_id;
            const { error } = await client.from("match_lineups").insert({
              match_id: match.id,
              team_id: teamId,
              player_name: inj.player.name,
              status: inj.player.reason?.toLowerCase().includes("suspens") ? "out_suspension" : "out_injury",
            });
            if (error) throw error;
            injuriesUpserted += 1;
          }
        }
      }
    }

    return { lineupsUpserted, injuriesUpserted, runWideScan };
  });
});
