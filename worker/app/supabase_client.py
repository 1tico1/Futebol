"""Acesso ao Supabase a partir do worker Python.

Sempre usa a service_role key (nunca a anon key) — mesmo padrão das Edge
Functions, já que este serviço escreve em `model_runs`/`team_ratings`, que
sob RLS só a service_role pode gravar (ver supabase/migrations).
"""

from __future__ import annotations

import os
from datetime import datetime
from functools import lru_cache

from supabase import Client, create_client

from .dixon_coles import MatchRecord


@lru_cache
def get_client() -> Client:
    url = os.environ["SUPABASE_URL"]
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return create_client(url, key)


def fetch_competition_id(client: Client, competition_external_id: str) -> int:
    res = client.table("competitions").select("id").eq("external_id", competition_external_id).single().execute()
    return res.data["id"]


def fetch_finished_matches(client: Client, competition_id: int, min_matches_seasons: int = 3) -> list[MatchRecord]:
    """Puxa o histórico de jogos finalizados das últimas temporadas da competição."""
    seasons_res = (
        client.table("seasons")
        .select("id, year")
        .eq("competition_id", competition_id)
        .order("year", desc=True)
        .limit(min_matches_seasons)
        .execute()
    )
    season_ids = [s["id"] for s in seasons_res.data]
    if not season_ids:
        return []

    matches_res = (
        client.table("matches")
        .select("home_team_id, away_team_id, home_goals, away_goals, kickoff_at, season_id")
        .in_("season_id", season_ids)
        .eq("status", "finished")
        .execute()
    )

    team_ids = {row["home_team_id"] for row in matches_res.data} | {row["away_team_id"] for row in matches_res.data}
    teams_res = client.table("teams").select("id, name").in_("id", list(team_ids)).execute()
    team_names = {t["id"]: t["name"] for t in teams_res.data}

    records = []
    for row in matches_res.data:
        if row["home_goals"] is None or row["away_goals"] is None:
            continue
        records.append(
            MatchRecord(
                home_team=team_names[row["home_team_id"]],
                away_team=team_names[row["away_team_id"]],
                home_goals=row["home_goals"],
                away_goals=row["away_goals"],
                played_at=datetime.fromisoformat(row["kickoff_at"].replace("Z", "+00:00")),
            )
        )
    return records


def fetch_team_id_by_name(client: Client, name: str) -> int:
    res = client.table("teams").select("id").eq("name", name).single().execute()
    return res.data["id"]


def insert_model_run(client: Client, competition_id: int, xi: float, rho: float, notes: str) -> int:
    res = (
        client.table("model_runs")
        .insert({"competition_id": competition_id, "method": "dixon_coles_v1", "xi": xi, "rho": rho, "notes": notes})
        .execute()
    )
    return res.data[0]["id"]


def insert_team_ratings(client: Client, model_run_id: int, ratings: list[dict]) -> None:
    client.table("team_ratings").insert(
        [{"model_run_id": model_run_id, **rating} for rating in ratings]
    ).execute()


def fetch_match(client: Client, match_id: int) -> dict:
    res = client.table("matches").select("id, home_team_id, away_team_id").eq("id", match_id).single().execute()
    return res.data


def fetch_model_run(client: Client, model_run_id: int) -> dict:
    res = client.table("model_runs").select("id, rho, xi").eq("id", model_run_id).single().execute()
    return res.data


def fetch_team_rating(client: Client, model_run_id: int, team_id: int) -> dict:
    res = (
        client.table("team_ratings")
        .select("attack, defense, home_advantage")
        .eq("model_run_id", model_run_id)
        .eq("team_id", team_id)
        .single()
        .execute()
    )
    return res.data
