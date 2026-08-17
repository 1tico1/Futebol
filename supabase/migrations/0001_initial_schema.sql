-- Schema inicial do Sistema de Probabilidades de Apostas
-- Ver docs/architecture.md (seção 3) e docs/tech-specs.md (seção 9) para o racional.

-- ============================================================
-- Competições e temporadas
-- ============================================================
create table competitions (
  id            bigint generated always as identity primary key,
  external_id   text unique,          -- id na API externa (API-Football etc.)
  name          text not null,        -- 'Brasileirão Série A', 'Copa Libertadores'
  country       text,
  tier          text                  -- 'league' | 'cup' | 'knockout'
);

create table seasons (
  id              bigint generated always as identity primary key,
  competition_id  bigint references competitions(id),
  year            int not null,
  start_date      date,
  end_date        date
);

create table teams (
  id                bigint generated always as identity primary key,
  external_id       text unique,
  name              text not null,
  country           text,
  venue_altitude_m  int  -- relevante para Libertadores (times de altitude)
);

-- ============================================================
-- Partidas
-- ============================================================
create table matches (
  id              bigint generated always as identity primary key,
  external_id     text unique,
  season_id       bigint references seasons(id),
  round           text,               -- 'Rodada 20', 'Semifinal - Ida'
  stage           text,               -- 'regular' | 'knockout_leg1' | 'knockout_leg2' | 'final'
  home_team_id    bigint references teams(id),
  away_team_id    bigint references teams(id),
  kickoff_at      timestamptz not null,
  status          text default 'scheduled', -- scheduled|live|finished|postponed
  home_goals      int,
  away_goals      int,
  home_xg         numeric,
  away_xg         numeric,
  venue           text,
  neutral_venue   boolean default false
);

-- Escalações e desfalques (para camada de IA/contexto)
create table match_lineups (
  id            bigint generated always as identity primary key,
  match_id      bigint references matches(id),
  team_id       bigint references teams(id),
  player_name   text,
  status        text  -- 'starting' | 'bench' | 'out_injury' | 'out_suspension' | 'doubtful'
);

-- ============================================================
-- Motor estatístico: parâmetros versionados por treino
-- ============================================================
create table model_runs (
  id              bigint generated always as identity primary key,
  competition_id  bigint references competitions(id),
  trained_at      timestamptz default now(),
  method          text,          -- 'dixon_coles_v1'
  xi              numeric,       -- decaimento temporal
  rho             numeric,       -- correção placares baixos
  notes           text
);

create table team_ratings (
  id              bigint generated always as identity primary key,
  model_run_id    bigint references model_runs(id),
  team_id         bigint references teams(id),
  attack          numeric not null,
  defense         numeric not null,
  home_advantage  numeric  -- gamma, pode ser global ou por time
);

-- ============================================================
-- Previsões geradas (o output final, auditável)
-- ============================================================
create table predictions (
  id                  bigint generated always as identity primary key,
  match_id            bigint references matches(id),
  model_run_id        bigint references model_runs(id),
  generated_at        timestamptz default now(),
  prob_home_win       numeric,
  prob_draw           numeric,
  prob_away_win       numeric,
  prob_btts_yes       numeric,
  prob_over_2_5       numeric,
  exact_score_probs   jsonb,   -- { "1-0": 0.14, "2-1": 0.11, ... } matriz completa
  ai_context_summary  text,    -- explicação em linguagem natural gerada pela LLM
  ai_adjustments      jsonb    -- ajustes contextuais aplicados e por quê, auditável
);

-- Odds de mercado, para comparar com sua previsão (value betting)
create table market_odds (
  id            bigint generated always as identity primary key,
  match_id      bigint references matches(id),
  bookmaker     text,
  captured_at   timestamptz default now(),
  market        text,      -- '1x2' | 'btts' | 'over_under_2_5' | 'correct_score'
  selection     text,      -- 'home' | 'draw' | 'away' | '2-1' etc.
  odd           numeric
);

-- ============================================================
-- Histórico de apostas reais (dado pessoal/financeiro, escopado por usuário)
-- ============================================================
create table bets (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null default auth.uid() references auth.users(id),
  match_id      bigint references matches(id),
  prediction_id bigint references predictions(id),
  market        text,
  selection     text,
  odd_taken     numeric,
  stake         numeric,
  placed_at     timestamptz default now(),
  result        text,        -- 'won' | 'lost' | 'void' | 'pending'
  settled_at    timestamptz
);

-- ============================================================
-- Observabilidade dos cron jobs (seção 9 das specs técnicas)
-- ============================================================
create table job_runs (
  id            bigint generated always as identity primary key,
  job_name      text not null,   -- 'fetch_fixtures' | 'fetch_results' | 'fetch_lineups_injuries'
                                  -- | 'fetch_market_odds' | 'train_model' | 'generate_prediction'
  status        text not null default 'running', -- 'running' | 'success' | 'error'
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  error_message text,
  details       jsonb
);

-- ============================================================
-- Índices recomendados
-- ============================================================
create index idx_matches_kickoff_at on matches(kickoff_at);
create index idx_matches_season_status on matches(season_id, status);
create index idx_match_lineups_match_id on match_lineups(match_id);
create index idx_team_ratings_model_run_id on team_ratings(model_run_id);
create index idx_predictions_match_id on predictions(match_id);
create index idx_market_odds_match_market on market_odds(match_id, market);
create index idx_bets_owner_id on bets(owner_id);
create index idx_job_runs_job_name_started_at on job_runs(job_name, started_at desc);

-- ============================================================
-- Row Level Security — ativado em todas as tabelas desde o dia 1
-- (docs/tech-specs.md, seção 9)
--
-- Tabelas de referência/pipeline (competitions..job_runs): leitura liberada
-- para usuários autenticados (dashboard), escrita reservada à service_role
-- (Edge Functions e worker Python usam a service key e por isso ignoram RLS
-- automaticamente — nenhuma policy de INSERT/UPDATE/DELETE é necessária
-- para esse fluxo).
--
-- `bets` é dado pessoal/financeiro: escopado por owner_id, cada usuário só
-- enxerga e edita as próprias apostas.
-- ============================================================
alter table competitions enable row level security;
alter table seasons enable row level security;
alter table teams enable row level security;
alter table matches enable row level security;
alter table match_lineups enable row level security;
alter table model_runs enable row level security;
alter table team_ratings enable row level security;
alter table predictions enable row level security;
alter table market_odds enable row level security;
alter table job_runs enable row level security;
alter table bets enable row level security;

create policy "authenticated can read competitions" on competitions for select to authenticated using (true);
create policy "authenticated can read seasons" on seasons for select to authenticated using (true);
create policy "authenticated can read teams" on teams for select to authenticated using (true);
create policy "authenticated can read matches" on matches for select to authenticated using (true);
create policy "authenticated can read match_lineups" on match_lineups for select to authenticated using (true);
create policy "authenticated can read model_runs" on model_runs for select to authenticated using (true);
create policy "authenticated can read team_ratings" on team_ratings for select to authenticated using (true);
create policy "authenticated can read predictions" on predictions for select to authenticated using (true);
create policy "authenticated can read market_odds" on market_odds for select to authenticated using (true);
create policy "authenticated can read job_runs" on job_runs for select to authenticated using (true);

create policy "users manage own bets" on bets
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
