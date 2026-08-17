// Job one-off (NÃO faz parte do agendamento pg_cron): importa as últimas 3
// temporadas de jogos finalizados de Brasileirão + Libertadores de uma vez,
// pra dar ao worker Python massa de dado suficiente pra treinar o Dixon-Coles
// (docs/architecture.md, seção 2, exige no mínimo ~3 temporadas de histórico).
//
// Rode manualmente UMA VEZ (Dashboard > Edge Functions > backfill_historical_matches
// > Invoke/Test), depois disso o fetch_fixtures/fetch_results normais do
// dia a dia já mantêm a base atualizada sozinhos.
//
// Versão autocontida (sem imports de ../_shared) pra colar direto no editor
// do dashboard, igual foi feito com generate_prediction.
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

function getServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configurados");
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

const BASE_URL = "https://v3.football.api-sports.io";

function getApiKey(): string {
  const key = Deno.env.get("API_FOOTBALL_KEY");
  if (!key) throw new Error("API_FOOTBALL_KEY não configurada");
  return key;
}

async function apiFootballGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "x-apisports-key": getApiKey() } });
  if (!res.ok) throw new Error(`API-Football ${path} falhou: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football ${path} retornou erros: ${JSON.stringify(json.errors)}`);
  }
  return json.response as T;
}

const COMPETITIONS = {
  brasileirao: { externalId: "71", name: "Brasileirão Série A", country: "Brazil", tier: "league" },
  libertadores: { externalId: "13", name: "Copa Libertadores", country: "South America", tier: "knockout" },
} as const;

function mapFixtureStatus(shortStatus: string): "scheduled" | "live" | "finished" | "postponed" {
  switch (shortStatus) {
    case "TBD":
    case "NS":
      return "scheduled";
    case "1H":
    case "HT":
    case "2H":
    case "ET":
    case "BT":
    case "P":
    case "LIVE":
      return "live";
    case "FT":
    case "AET":
    case "PEN":
      return "finished";
    case "PST":
    case "CANC":
    case "ABD":
    case "SUSP":
    case "INT":
      return "postponed";
    default:
      return "scheduled";
  }
}

async function upsertCompetition(client: SupabaseClient, key: keyof typeof COMPETITIONS): Promise<number> {
  const comp = COMPETITIONS[key];
  const { data, error } = await client
    .from("competitions")
    .upsert({ external_id: comp.externalId, name: comp.name, country: comp.country, tier: comp.tier }, { onConflict: "external_id" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

async function upsertSeason(client: SupabaseClient, competitionId: number, year: number): Promise<number> {
  const { data: existing } = await client
    .from("seasons")
    .select("id")
    .eq("competition_id", competitionId)
    .eq("year", year)
    .maybeSingle();
  if (existing) return existing.id as number;

  const { data, error } = await client
    .from("seasons")
    .insert({ competition_id: competitionId, year })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

async function upsertTeam(client: SupabaseClient, externalId: string | number, name: string): Promise<number> {
  const { data, error } = await client
    .from("teams")
    .upsert({ external_id: String(externalId), name }, { onConflict: "external_id" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

// Quantas temporadas passadas importar (docs/architecture.md pede "mínimo 3 temporadas").
const SEASONS_BACK = 3;

Deno.serve(async (_req) => {
  const client = getServiceClient();
  const currentYear = new Date().getUTCFullYear();
  const seasons = Array.from({ length: SEASONS_BACK }, (_, i) => currentYear - i);

  const summary: Record<string, unknown> = {};

  try {
    for (const key of Object.keys(COMPETITIONS) as (keyof typeof COMPETITIONS)[]) {
      const comp = COMPETITIONS[key];
      const competitionId = await upsertCompetition(client, key);
      let upserted = 0;

      for (const year of seasons) {
        const seasonId = await upsertSeason(client, competitionId, year);
        // deno-lint-ignore no-explicit-any
        const fixtures = await apiFootballGet<any[]>("/fixtures", { league: comp.externalId, season: year });

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
              home_goals: fx.goals?.home ?? null,
              away_goals: fx.goals?.away ?? null,
              venue: fx.fixture.venue?.name ?? null,
            },
            { onConflict: "external_id" },
          );
          if (error) throw error;
          upserted += 1;
        }
      }

      summary[key] = { upserted, seasons };
    }

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, error: errorMessage, partial: summary }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
