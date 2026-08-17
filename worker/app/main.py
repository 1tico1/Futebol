"""Worker Python — treino e inferência do modelo Dixon-Coles.

Chamado via HTTP pelas Supabase Edge Functions `train_model` e
`generate_prediction` (docs/architecture.md, seção 4). Hospedagem
recomendada: Fly.io ou Cloud Run para custo mínimo, Render Starter como
alternativa (docs/tech-specs.md, seção 2).
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException

load_dotenv()

from .dixon_coles import fit_dixon_coles, probability_matrix, summarize_matrix
from .schemas import PredictRequest, PredictResponse, TrainRequest, TrainResponse
from .supabase_client import (
    fetch_competition_id,
    fetch_finished_matches,
    fetch_match,
    fetch_model_run,
    fetch_team_id_by_name,
    fetch_team_rating,
    get_client,
    insert_model_run,
    insert_team_ratings,
)

app = FastAPI(title="Futebol — Worker Dixon-Coles")


def _check_secret(x_worker_secret: str | None) -> None:
    expected = os.environ.get("WORKER_SHARED_SECRET")
    if not expected or x_worker_secret != expected:
        raise HTTPException(status_code=401, detail="X-Worker-Secret ausente ou inválido")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/train", response_model=TrainResponse)
def train(body: TrainRequest, x_worker_secret: str | None = Header(default=None)) -> TrainResponse:
    _check_secret(x_worker_secret)
    client = get_client()

    competition_id = fetch_competition_id(client, body.competition_external_id)
    matches = fetch_finished_matches(client, competition_id)
    if len(matches) < 10:
        raise HTTPException(
            status_code=422,
            detail=f"histórico insuficiente para treinar (encontradas {len(matches)} partidas finalizadas)",
        )

    params = fit_dixon_coles(matches)
    model_run_id = insert_model_run(client, competition_id, params.xi, params.rho, params.notes)

    ratings = []
    for team_name in params.teams:
        team_id = fetch_team_id_by_name(client, team_name)
        ratings.append(
            {
                "team_id": team_id,
                "attack": params.attack[team_name],
                "defense": params.defense[team_name],
                "home_advantage": params.home_advantage,
            }
        )
    insert_team_ratings(client, model_run_id, ratings)

    return TrainResponse(
        model_run_id=model_run_id,
        teams_trained=len(params.teams),
        matches_used=len(matches),
        xi=params.xi,
        rho=params.rho,
        home_advantage=params.home_advantage,
    )


@app.post("/predict", response_model=PredictResponse)
def predict(body: PredictRequest, x_worker_secret: str | None = Header(default=None)) -> PredictResponse:
    _check_secret(x_worker_secret)
    client = get_client()

    match = fetch_match(client, body.match_id)
    model_run = fetch_model_run(client, body.model_run_id)
    home_rating = fetch_team_rating(client, body.model_run_id, match["home_team_id"])
    away_rating = fetch_team_rating(client, body.model_run_id, match["away_team_id"])

    matrix = probability_matrix(
        attack_home=home_rating["attack"],
        defense_home=home_rating["defense"],
        attack_away=away_rating["attack"],
        defense_away=away_rating["defense"],
        gamma=home_rating["home_advantage"],
        rho=model_run["rho"],
    )
    summary = summarize_matrix(matrix)

    return PredictResponse(**summary)
