// Consultas compartilhadas entre o dashboard e a página de detalhe da
// partida. Ficam num módulo à parte pra não duplicar a lógica de "forma
// recente" e "confrontos diretos" entre páginas.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormResult } from "@/components/FormBadges";

type TeamJoin = { name: string } | null;

type RawFormRow = {
  id: number;
  kickoff_at: string;
  home_team_id: number;
  away_team_id: number;
  home_goals: number | null;
  away_goals: number | null;
  home_team: TeamJoin;
  away_team: TeamJoin;
};

export async function getRecentForm(
  supabase: SupabaseClient,
  teamId: number,
  excludeMatchId?: number,
  limit = 5,
): Promise<FormResult[]> {
  let query = supabase
    .from("matches")
    .select(
      "id, kickoff_at, home_team_id, away_team_id, home_goals, away_goals, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)",
    )
    .eq("status", "finished")
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("kickoff_at", { ascending: false })
    .limit(limit);

  if (excludeMatchId) query = query.neq("id", excludeMatchId);

  const { data } = await query.returns<RawFormRow[]>();

  return (data ?? []).map((m) => {
    const isHome = m.home_team_id === teamId;
    const goalsFor = isHome ? m.home_goals : m.away_goals;
    const goalsAgainst = isHome ? m.away_goals : m.home_goals;

    let result: FormResult["result"] = "D";
    if (goalsFor !== null && goalsAgainst !== null) {
      if (goalsFor > goalsAgainst) result = "W";
      else if (goalsFor < goalsAgainst) result = "L";
    }

    return {
      id: m.id,
      result,
      goalsFor,
      goalsAgainst,
      isHome,
      opponent: (isHome ? m.away_team?.name : m.home_team?.name) ?? null,
    };
  });
}

export type HeadToHeadMatch = {
  id: number;
  kickoff_at: string;
  home_goals: number | null;
  away_goals: number | null;
  home_team: TeamJoin;
  away_team: TeamJoin;
};

export async function getHeadToHead(
  supabase: SupabaseClient,
  teamAId: number,
  teamBId: number,
  limit = 5,
): Promise<HeadToHeadMatch[]> {
  const { data } = await supabase
    .from("matches")
    .select(
      "id, kickoff_at, home_goals, away_goals, home_team:teams!matches_home_team_id_fkey(name), away_team:teams!matches_away_team_id_fkey(name)",
    )
    .eq("status", "finished")
    .or(
      `and(home_team_id.eq.${teamAId},away_team_id.eq.${teamBId}),and(home_team_id.eq.${teamBId},away_team_id.eq.${teamAId})`,
    )
    .order("kickoff_at", { ascending: false })
    .limit(limit)
    .returns<HeadToHeadMatch[]>();

  return data ?? [];
}
