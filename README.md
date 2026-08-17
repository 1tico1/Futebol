# Futebol

Sistema de probabilidades para apostas esportivas — Brasileirão Série A +
Copa Libertadores. Motor estatístico Dixon-Coles (determinístico) para
gerar as probabilidades, com uma camada de IA generativa (Claude) só para
contexto qualitativo e ajustes pequenos e auditáveis — nunca para gerar o
número em si. Ver `docs/architecture.md` para o desenho completo.

## Documentação

- [`docs/architecture.md`](docs/architecture.md) — arquitetura técnica completa: modelo estatístico, schema de dados, pipeline de ingestão, papel da IA generativa, cálculo de value bet, roadmap.
- [`docs/tech-specs.md`](docs/tech-specs.md) — bill of materials técnico: plano/tamanho/custo de cada peça de infra, dimensionado para o volume real do projeto.

## Estrutura do repositório

```
docs/                     # arquitetura + specs técnicas
supabase/
  migrations/              # schema SQL (RLS habilitado desde o dia 1) + agendamento pg_cron
  functions/                # Edge Functions (Deno) — um job por pasta
    fetch_fixtures/
    fetch_results/
    fetch_lineups_injuries/
    fetch_market_odds/
    train_model/            # ponte HTTP até o worker Python
    generate_prediction/    # worker Python (probabilidade) + Claude API (contexto/ajustes)
    _shared/                 # clientes Supabase/API-Football, helpers de log
worker/                    # serviço Python (FastAPI) — treino e inferência do Dixon-Coles
  app/
    dixon_coles.py           # motor estatístico (100% determinístico)
    supabase_client.py
    main.py                  # endpoints /train e /predict
frontend/                  # dashboard Next.js (App Router)
```

## Stack

| Peça | Tecnologia | Hosting recomendado |
|---|---|---|
| Banco/backend | Supabase (Postgres + Auth + Edge Functions + Cron) | Supabase Pro |
| Worker estatístico | Python 3.12 / FastAPI / scipy / numpy | Fly.io ou Cloud Run (custo mínimo) |
| Fonte de dados | API-Football | Plano Pro |
| IA generativa | Claude (Haiku para resumo, Sonnet para ajuste contextual) | API da Anthropic |
| Frontend | Next.js 15 (App Router) | Vercel Hobby |

Custo mensal estimado do conjunto: **≈ US$48-55/mês** (detalhamento em `docs/tech-specs.md`, seção 8).

## Como rodar cada peça

### Supabase (banco + Edge Functions)

```bash
supabase login
supabase link --project-ref <seu-project-ref>
supabase db push                 # aplica supabase/migrations
supabase functions deploy        # publica todas as Edge Functions
```

Antes de aplicar `0002_cron_jobs.sql`, cadastre os secrets no Vault do
projeto (`project_url`, `service_role_key`) — instruções no topo do
próprio arquivo de migration. Configure também as env vars das Edge
Functions (`API_FOOTBALL_KEY`, `MODEL_WORKER_URL`,
`MODEL_WORKER_SHARED_SECRET`, `ANTHROPIC_API_KEY`) via
`supabase secrets set`.

### Worker Python

```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # preencher
uvicorn app.main:app --reload
```

Detalhes de deploy em `worker/README.md`.

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local   # preencher com URL + anon key do Supabase
npm run dev
```

## Segurança

- RLS ativado em todas as tabelas desde a primeira migration.
- Chaves de API (API-Football, Anthropic, service_role do Supabase) só
  existem em variáveis de ambiente do lado servidor (Edge Functions/worker)
  — nunca no client Next.js, que só usa a chave anon.
- Toda execução de cron job é logada em `job_runs` (status/erro), para
  falha silenciosa de ingestão não passar despercebida.

## Aviso

Nenhum modelo estatístico "acerta apostas" de forma garantida. O valor do
sistema é ter probabilidades melhor calibradas e identificar possíveis
value bets frente ao mercado — não eliminar a variância do esporte. Não
use para apostas reais antes de rodar o backtesting descrito em
`docs/architecture.md` (seção 2.4).
