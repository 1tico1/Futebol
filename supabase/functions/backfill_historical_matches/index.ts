// Job one-off (NÃO faz parte do agendamento pg_cron): importa jogos
// finalizados de Brasileirão/Libertadores de UMA temporada por invocação,
// pra dar ao worker Python massa de dado suficiente pra treinar o
// Dixon-Coles (docs/architecture.md, seção 2, exige mínimo ~3 temporadas).
//
// Processar tudo numa invocação só estoura o limite de recursos da Edge
// Function (testado: WORKER_RESOURCE_LIMIT com 2 competições x 3 temporadas
// juntas) — por isso o escopo é reduzido a 1 competição + 1 temporada por
// chamada. Invoque 6x (2 competições x 3 temporadas), variando o body:
//   {"competition": "brasileirao", "season": 2026}
//   {"competition": "brasileirao", "season": 2025}
//   {"competition": "brasileirao", "season": 2024}
//   {"competition": "libertadores", "season": 2026}
//   {"competition": "libertadores", "season": 2025}
//   {"competition": "libertadores", "season": 2024}
// Upserts são idempotentes (onConflict external_id), então repetir uma
// combinação já processada não faz mal.
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

Deno.serve(async (req) => {
  let body: { competition?: string; season?: number } = {};
  try {
    body = await req.json();
  } catch {
    // sem body = erro de uso, tratado abaixo
  }

  const competitionKey = body.competition as keyof typeof COMPETITIONS | undefined;
  const season = body.season;

  if (!competitionKey || !COMPETITIONS[competitionKey] || !season) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: 'Body precisa ser {"competition": "brasileirao"|"libertadores", "season": <ano>}',
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const client = getServiceClient();
  const comp = COMPETITIONS[competitionKey];

  try {
    const competitionId = await upsertCompetition(client, competitionKey);
    const seasonId = await upsertSeason(client, competitionId, season);
    // deno-lint-ignore no-explicit-any
    const fixtures = await apiFootballGet<any[]>("/fixtures", { league: comp.externalId, season });

    let upserted = 0;
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

    return new Response(JSON.stringify({ ok: true, competition: competitionKey, season, upserted }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ ok: false, competition: competitionKey, season, error: errorMessage }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
