-- A migration 0001 liberou leitura só para o role `authenticated`, mas o
-- frontend (dashboard) não implementa login — ele lê com a chave anônima
-- (role `anon`). Sem essa policy, o RLS bloqueia silenciosamente toda
-- leitura do dashboard (retorna 0 linhas, sem erro).
--
-- Dado que os dados aqui são estatísticas públicas de futebol (não é
-- informação sensível), liberar leitura anônima é uma escolha razoável.
-- `bets` continua restrita — é dado financeiro pessoal e exige
-- autenticação + owner_id (ver 0001_initial_schema.sql). `job_runs`
-- também fica de fora (é log operacional interno, sem uso no dashboard).

create policy "anon can read competitions" on competitions for select to anon using (true);
create policy "anon can read seasons" on seasons for select to anon using (true);
create policy "anon can read teams" on teams for select to anon using (true);
create policy "anon can read matches" on matches for select to anon using (true);
create policy "anon can read match_lineups" on match_lineups for select to anon using (true);
create policy "anon can read model_runs" on model_runs for select to anon using (true);
create policy "anon can read team_ratings" on team_ratings for select to anon using (true);
create policy "anon can read predictions" on predictions for select to anon using (true);
create policy "anon can read market_odds" on market_odds for select to anon using (true);
