// Helpers de upsert para as tabelas de referência (competitions, seasons, teams),
// reaproveitados por fetch_fixtures, fetch_results e fetch_lineups_injuries.
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { COMPETITIONS } from "./apiFootball.ts";

export async function upsertCompetition(
  client: SupabaseClient,
  key: keyof typeof COMPETITIONS,
): Promise<number> {
  const comp = COMPETITIONS[key];
  const { data, error } = await client
    .from("competitions")
    .upsert(
      { external_id: comp.externalId, name: comp.name, country: comp.country, tier: comp.tier },
      { onConflict: "external_id" },
    )
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

export async function upsertSeason(
  client: SupabaseClient,
  competitionId: number,
  year: number,
): Promise<number> {
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

export async function upsertTeam(
  client: SupabaseClient,
  externalId: string | number,
  name: string,
): Promise<number> {
  const { data, error } = await client
    .from("teams")
    .upsert({ external_id: String(externalId), name }, { onConflict: "external_id" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

export function currentSeasonYear(): number {
  const override = Deno.env.get("SEASON_YEAR");
  return override ? Number(override) : new Date().getUTCFullYear();
}
