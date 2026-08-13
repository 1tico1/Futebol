# Worker Dixon-Coles

Serviço Python (FastAPI) responsável pelo treino do modelo estatístico e
pelo cálculo da matriz de probabilidades por partida. Ver
`docs/architecture.md` (seção 2) para o racional do modelo e
`docs/tech-specs.md` (seção 2) para as specs de hosting.

## Rodando localmente

```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # preencher com as credenciais do seu projeto Supabase
uvicorn app.main:app --reload
```

## Endpoints

- `GET /health` — healthcheck.
- `POST /train` — `{ "competition_external_id": "71", "season": 2026 }`. Treina o Dixon-Coles com o histórico de partidas finalizadas da competição e grava `model_runs` + `team_ratings`.
- `POST /predict` — `{ "match_id": 123, "model_run_id": 45 }`. Calcula a matriz de probabilidade para a partida usando os ratings do treino informado.

Ambos exigem o header `X-Worker-Secret` com o mesmo valor de `WORKER_SHARED_SECRET`.

## Deploy

Recomendação (docs/tech-specs.md, seção 2): comece em **Fly.io** (`shared-cpu-1x`, 256MB) ou **Cloud Run** (pay-per-use) — custo de poucos dólares/mês nesse volume. Só migre para Render Standard ou instância maior se o treino passar a demorar minutos.

```bash
docker build -t futebol-worker .
docker run --env-file .env -p 8000:8000 futebol-worker
```
