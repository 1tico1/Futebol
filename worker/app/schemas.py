from pydantic import BaseModel


class TrainRequest(BaseModel):
    competition_external_id: str
    season: int


class TrainResponse(BaseModel):
    model_run_id: int
    teams_trained: int
    matches_used: int
    xi: float
    rho: float
    home_advantage: float


class PredictRequest(BaseModel):
    match_id: int
    model_run_id: int


class PredictResponse(BaseModel):
    prob_home_win: float
    prob_draw: float
    prob_away_win: float
    prob_btts_yes: float
    prob_over_2_5: float
    exact_score_probs: dict[str, float]
