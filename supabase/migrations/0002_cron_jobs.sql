-- Agendamento dos jobs via pg_cron + pg_net, disparando as Edge Functions.
-- Ver docs/tech-specs.md (seção 7) para a frequência recomendada de cada job.
--
-- IMPORTANTE — pré-requisito antes de aplicar esta migration em produção:
-- cadastre dois secrets no Vault do projeto (Dashboard > Project Settings > Vault,
-- ou via SQL abaixo) com a URL do projeto e a service_role key. As Edge Functions
-- rodam com a service key (bypassa RLS por design — é o mesmo padrão usado pelo
-- worker Python), nunca exponha essa chave no client Next.js.
--
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
--
-- Nota sobre timezone: todos os horários abaixo estão em UTC. O Brasil (BRT) é
-- UTC-3 sem horário de verão desde 2019, então "03h" nas specs técnicas = "06:00 UTC".

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;

create or replace function private.invoke_edge_function(function_name text, payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  project_url text;
  service_key text;
begin
  select decrypted_secret into project_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into service_key from vault.decrypted_secrets where name = 'service_role_key';

  if project_url is null or service_key is null then
    raise exception 'Vault secrets "project_url"/"service_role_key" não configurados';
  end if;

  perform net.http_post(
    url := project_url || '/functions/v1/' || function_name,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := payload
  );
end;
$$;

-- ------------------------------------------------------------
-- fetch_fixtures — 1x/dia, 03h BRT (06:00 UTC)
-- ------------------------------------------------------------
select cron.schedule(
  'fetch_fixtures_daily',
  '0 6 * * *',
  $$ select private.invoke_edge_function('fetch_fixtures'); $$
);

-- ------------------------------------------------------------
-- fetch_results — 1x/dia, 07h BRT (10:00 UTC), cobre jogos da noite anterior
-- ------------------------------------------------------------
select cron.schedule(
  'fetch_results_daily',
  '0 10 * * *',
  $$ select private.invoke_edge_function('fetch_results'); $$
);

-- ------------------------------------------------------------
-- fetch_lineups_injuries — cadência-base a cada 6h; a função dispara a cada
-- hora e decide internamente (com base em `matches.kickoff_at`) se apertar
-- para 1x/hora nas 6h antes de um kickoff, seguindo a regra das specs
-- técnicas sem precisar de N jobs cron condicionais.
-- ------------------------------------------------------------
select cron.schedule(
  'fetch_lineups_injuries_hourly',
  '0 * * * *',
  $$ select private.invoke_edge_function('fetch_lineups_injuries'); $$
);

-- ------------------------------------------------------------
-- fetch_market_odds — 3x/dia fixas (manhã/tarde) + captura extra 2h antes do
-- jogo. Igual ao job de lineups, dispara a cada hora e a função decide.
-- ------------------------------------------------------------
select cron.schedule(
  'fetch_market_odds_hourly',
  '0 * * * *',
  $$ select private.invoke_edge_function('fetch_market_odds'); $$
);

-- ------------------------------------------------------------
-- train_model — 1x/dia, madrugada (05h BRT / 08:00 UTC), depois de
-- fetch_results já ter atualizado os placares do dia anterior
-- ------------------------------------------------------------
select cron.schedule(
  'train_model_daily',
  '0 8 * * *',
  $$ select private.invoke_edge_function('train_model'); $$
);

-- ------------------------------------------------------------
-- generate_prediction — 24h antes do kickoff + atualização 2h antes.
-- Dispara a cada hora; a função consulta `matches` e gera/atualiza previsão
-- só para os jogos que caem nessas janelas.
-- ------------------------------------------------------------
select cron.schedule(
  'generate_prediction_hourly',
  '0 * * * *',
  $$ select private.invoke_edge_function('generate_prediction'); $$
);
