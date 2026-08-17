// Job: fetch_market_odds — 3x/dia (manhã/tarde) + captura extra 2h antes do
// jogo (docs/tech-specs.md, seção 7). Cron dispara a cada hora; a função
// decide se é uma "rodada ampla" (horários fixos) ou só a checagem de
// pré-kickoff.
import { getServiceClient } from "../_shared/supabaseClient.ts";
import { withJobRun } from "../_shared/jobRun.ts";
import { getOdds } from "../_shared/apiFootball.ts";

// 09h e 15h BRT = 12:00 e 18:00 UTC.
const BROAD_SCAN_HOURS_UTC = [12, 18];
const BROAD_SCAN_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const PRE_KICKOFF_WINDOW_MS = 2 * 60 * 60 * 1000;

const MARKET_NAME_MAP: Record<string, string> = {
  "Match Winner": "1x2",
  "Both Teams Score": "btts",
  "Goals Over/Under": "over_under_2_5",
};

Deno.serve(async (_req) => {
  const client = getServiceClient();

  return await withJobRun(client, "fetch_market_odds", async () => {
    const now = new Date();
    const isBroadScan = BROAD_SCAN_HOURS_UTC.includes(now.getUTCHours());
    const windowMs = isBroadScan ? BROAD_SCAN_WINDOW_MS : PRE_KICKOFF_WINDOW_MS;

    const { data: matches, error } = await client
      .from("matches")
      .select("id, external_id")
      .eq("status", "scheduled")
      .gte("kickoff_at", now.toISOString())
      .lte("kickoff_at", new Date(now.getTime() + windowMs).toISOString());
    if (error) throw error;

    let oddsCaptured = 0;

    for (const match of matches ?? []) {
      // deno-lint-ignore no-explicit-any
      const response = await getOdds(match.external_id) as any[];
      const rows: Record<string, unknown>[] = [];

      for (const entry of response) {
        for (const bookmaker of entry.bookmakers ?? []) {
          for (const bet of bookmaker.bets ?? []) {
            const market = MARKET_NAME_MAP[bet.name];
            if (!market) continue; // só guardamos os mercados que o schema cobre hoje

            for (const value of bet.values ?? []) {
              rows.push({
                match_id: match.id,
                bookmaker: bookmaker.name,
                market,
                selection: String(value.value).toLowerCase(),
                odd: Number(value.odd),
              });
            }
          }
        }
      }

      if (rows.length > 0) {
        const { error: insertErr } = await client.from("market_odds").insert(rows);
        if (insertErr) throw insertErr;
        oddsCaptured += rows.length;
      }
    }

    return { oddsCaptured, isBroadScan, matchesChecked: matches?.length ?? 0 };
  });
});
