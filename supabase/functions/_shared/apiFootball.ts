// Cliente mínimo para a API-Football (v3.football.api-sports.io).
// Ver docs/architecture.md (seção 1) e docs/tech-specs.md (seção 3) para o
// racional de escolha do provedor e o budget de requisições esperado.

const BASE_URL = "https://v3.football.api-sports.io";

function getApiKey(): string {
  const key = Deno.env.get("API_FOOTBALL_KEY");
  if (!key) throw new Error("API_FOOTBALL_KEY não configurada");
  return key;
}

async function apiFootballGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: { "x-apisports-key": getApiKey() },
  });

  if (!res.ok) {
    throw new Error(`API-Football ${path} falhou: ${res.status} ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length > 0) {
    throw new Error(`API-Football ${path} retornou erros: ${JSON.stringify(json.errors)}`);
  }
  return json.response as T;
}

// IDs das competições no catálogo da API-Football.
// Confirmar/ajustar após inspecionar /leagues com a chave real (podem variar).
export const COMPETITIONS = {
  brasileirao: { externalId: "71", name: "Brasileirão Série A", country: "Brazil", tier: "league" },
  libertadores: { externalId: "13", name: "Copa Libertadores", country: "South America", tier: "knockout" },
} as const;

export function getFixtures(leagueExternalId: string, season: number) {
  return apiFootballGet<unknown[]>("/fixtures", { league: leagueExternalId, season });
}

export function getFixturesByDateRange(leagueExternalId: string, season: number, from: string, to: string) {
  return apiFootballGet<unknown[]>("/fixtures", { league: leagueExternalId, season, from, to });
}

export function getFixtureLineups(fixtureExternalId: string) {
  return apiFootballGet<unknown[]>("/fixtures/lineups", { fixture: fixtureExternalId });
}

export function getInjuries(leagueExternalId: string, season: number) {
  return apiFootballGet<unknown[]>("/injuries", { league: leagueExternalId, season });
}

export function getOdds(fixtureExternalId: string) {
  return apiFootballGet<unknown[]>("/odds", { fixture: fixtureExternalId });
}
