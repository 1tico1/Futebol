"""Motor estatístico Dixon-Coles (Dixon & Coles, 1997).

Ver docs/architecture.md, seção 2, para o racional completo. Resumo:
Poisson pura subestima placares baixos (0-0, 1-0, 0-1, 1-1); o fator tau()
corrige isso, e o peso temporal (xi) faz jogos recentes pesarem mais que
jogos antigos ao estimar força de ataque/defesa por time.

Este módulo é 100% determinístico e testável — nenhuma chamada de IA
generativa entra aqui (ver princípio central da arquitetura, seção 0).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Sequence

import numpy as np
from scipy.optimize import minimize
from scipy.stats import poisson


@dataclass
class MatchRecord:
    home_team: str
    away_team: str
    home_goals: int
    away_goals: int
    played_at: datetime


@dataclass
class DixonColesParams:
    teams: list[str]
    attack: dict[str, float]
    defense: dict[str, float]
    home_advantage: float
    rho: float
    xi: float
    notes: str = field(default="")


def _tau(x: int, y: int, lam: float, mu: float, rho: float) -> float:
    """Fator de correção de Dixon-Coles para os 4 placares baixos."""
    if x == 0 and y == 0:
        return 1 - lam * mu * rho
    if x == 0 and y == 1:
        return 1 + lam * rho
    if x == 1 and y == 0:
        return 1 + mu * rho
    if x == 1 and y == 1:
        return 1 - rho
    return 1.0


def fit_dixon_coles(
    matches: Sequence[MatchRecord],
    xi: float = 0.0018,
    as_of: datetime | None = None,
) -> DixonColesParams:
    """Estima ataque/defesa por time + gamma (mando) + rho via máxima verossimilhança.

    `xi` é a taxa de decaimento temporal (dia^-1) — um hiperparâmetro fixo,
    não ajustado junto com o resto (é assim que o paper original trata),
    escolhido para dar meia-vida de aproximadamente 1 temporada.
    """
    if len(matches) < 10:
        raise ValueError("histórico insuficiente para treinar o modelo (mínimo 10 partidas)")

    as_of = as_of or datetime.now(timezone.utc)
    teams = sorted({m.home_team for m in matches} | {m.away_team for m in matches})
    n = len(teams)
    idx = {t: i for i, t in enumerate(teams)}

    weights = np.array([np.exp(-xi * max((as_of - m.played_at).days, 0)) for m in matches])

    def unpack(theta: np.ndarray):
        attack = theta[:n]
        defense = theta[n : 2 * n]
        gamma = theta[2 * n]
        rho = theta[2 * n + 1]
        return attack, defense, gamma, rho

    def neg_log_lik(theta: np.ndarray) -> float:
        attack, defense, gamma, rho = unpack(theta)
        total = 0.0
        for w, m in zip(weights, matches):
            hi, ai = idx[m.home_team], idx[m.away_team]
            lam = float(np.exp(attack[hi] + defense[ai] + gamma))
            mu = float(np.exp(attack[ai] + defense[hi]))
            tau = max(_tau(m.home_goals, m.away_goals, lam, mu, rho), 1e-10)
            total += w * (
                np.log(tau) + poisson.logpmf(m.home_goals, lam) + poisson.logpmf(m.away_goals, mu)
            )
        # regularização leve para identificabilidade (ataque/defesa somam ~0)
        total -= 0.01 * (float(np.sum(attack)) ** 2 + float(np.sum(defense)) ** 2)
        return -total

    theta0 = np.zeros(2 * n + 2)
    result = minimize(neg_log_lik, theta0, method="L-BFGS-B")
    if not result.success:
        raise RuntimeError(f"otimização não convergiu: {result.message}")

    attack, defense, gamma, rho = unpack(result.x)
    return DixonColesParams(
        teams=teams,
        attack=dict(zip(teams, attack.tolist())),
        defense=dict(zip(teams, defense.tolist())),
        home_advantage=float(gamma),
        rho=float(rho),
        xi=xi,
        notes=f"treinado com {len(matches)} partidas, as_of={as_of.isoformat()}",
    )


def probability_matrix(
    attack_home: float,
    defense_home: float,
    attack_away: float,
    defense_away: float,
    gamma: float,
    rho: float,
    max_goals: int = 7,
) -> np.ndarray:
    lam = float(np.exp(attack_home + defense_away + gamma))
    mu = float(np.exp(attack_away + defense_home))

    matrix = np.zeros((max_goals, max_goals))
    for x in range(max_goals):
        for y in range(max_goals):
            matrix[x, y] = _tau(x, y, lam, mu, rho) * poisson.pmf(x, lam) * poisson.pmf(y, mu)

    matrix = np.clip(matrix, 0, None)
    matrix /= matrix.sum()
    return matrix


def summarize_matrix(matrix: np.ndarray) -> dict:
    """Deriva 1X2, BTTS, over/under e placar exato a partir da matriz de probabilidade."""
    rows, cols = matrix.shape
    home_win = float(np.sum(np.tril(matrix, -1)))  # gols_casa > gols_fora
    draw = float(np.sum(np.diag(matrix)))
    away_win = float(np.sum(np.triu(matrix, 1)))  # gols_fora > gols_casa
    btts_yes = float(sum(matrix[x, y] for x in range(1, rows) for y in range(1, cols)))
    over_2_5 = float(sum(matrix[x, y] for x in range(rows) for y in range(cols) if x + y > 2))
    exact_score_probs = {f"{x}-{y}": float(matrix[x, y]) for x in range(rows) for y in range(cols)}

    return {
        "prob_home_win": home_win,
        "prob_draw": draw,
        "prob_away_win": away_win,
        "prob_btts_yes": btts_yes,
        "prob_over_2_5": over_2_5,
        "exact_score_probs": exact_score_probs,
    }
