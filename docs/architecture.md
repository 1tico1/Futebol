# Sistema de Probabilidades para Apostas Esportivas — Arquitetura Técnica

**Escopo inicial:** Brasileirão Série A + Copa Libertadores
**Stack-base definida pelo usuário:** Supabase (Postgres) + IA generativa
**Data do documento:** 13/08/2026

---

## 0. Princípio central do sistema

O ponto mais importante de todo o desenho, então vale deixar explícito antes de qualquer diagrama: **a probabilidade não deve ser gerada pela IA generativa**. LLMs não fazem contagem confiável de gols, não sabem multiplicar distribuições de Poisson e alucinam números com muita facilidade. O papel da IA generativa aqui é outro: interpretar contexto qualitativo (lesões, desfalques, mando de campo, notícias, escalação provável, motivação — ex. mata-mata x jogo sem importância) e traduzir a saída de um **motor estatístico determinístico** em texto explicativo e ajustes de parâmetros pequenos e auditáveis.

Ou seja, a arquitetura tem duas camadas de "inteligência" que não se confundem:

1. **Motor de probabilidade (matemático/estatístico)** — Poisson/Dixon-Coles + ratings de força (Elo/power ratings), rodando em Python/SQL, 100% determinístico e testável.
2. **Camada de IA generativa (LLM)** — RAG sobre notícias/lesões/escalações + geração de explicações em linguagem natural + pequenos ajustes contextuais (ex.: "-8% na força ofensiva porque o artilheiro está fora"), sempre com o número bruto do modelo estatístico visível ao lado, nunca escondido.

Isso é o que separa um sistema sério de um "gerador de números aleatórios com aparência de IA" — e é também o que vai te dar previsões que você consegue auditar e melhorar com o tempo (backtesting).

**Aviso importante:** nenhum modelo estatístico "acerta apostas" de forma garantida — casas de apostas embutem margem (overround) e o resultado de uma partida individual sempre tem variância alta. O valor real do sistema é ter probabilidades melhor calibradas que o "achismo", identificar **value bets** (quando sua probabilidade estimada diverge da probabilidade implícita na odd oferecida) e registrar tudo para você avaliar performance ao longo do tempo — não prometer greens.

---

## 1. Fontes de dados

Pesquisei os principais provedores com cobertura de Brasileirão e Libertadores. Resumo comparativo:

| Provedor | Cobertura BR/Libertadores | Dados disponíveis | Preço aproximado |
|---|---|---|---|
| **API-Football (API-Sports)** | Sim, todas as competições em todos os planos | Fixtures, odds pré-jogo e live, estatísticas de time/jogador, escalações, lesões/desfalques (sidelined), H2H, standings, **predictions** nativas (usar como referência, não como fonte final) | Free (100 req/dia), Pro US$19 (7.500/dia), Ultra US$29 (75.000/dia), Mega US$39 (150.000/dia) — [api-football.com/pricing](https://www.api-football.com/pricing) |
| **SportMonks** | Página dedicada ao Brasileirão | Dados avançados, xG em alguns planos, cobertura ampla de ligas sul-americanas | Planos pagos, cotar conforme volume — [sportmonks.com/football-api/brasileirao-api](https://www.sportmonks.com/football-api/brasileirao-api/) |
| **football-data.org** | Cobertura mais forte em ligas europeias; verificar disponibilidade de Brasileirão/Libertadores no plano usado | Fixtures, resultados, standings, básico | Free tier limitado (10 req/min), planos pagos — [football-data.org/coverage](https://www.football-data.org/coverage) |

**Recomendação prática para começar:** API-Football/API-Sports. É a opção com melhor custo-benefício para o MVP porque o plano Pro (US$19/mês) já libera lesões, escalações prováveis, odds e estatísticas detalhadas em todas as competições, incluindo Brasileirão e Libertadores — o que evita ter que combinar 2-3 provedores diferentes logo de cara. Dá pra adicionar SportMonks depois como fonte secundária de xG quando o sistema já estiver maduro (xG melhora bastante a qualidade do modelo Poisson, ver seção 4).

Dados que você vai precisar puxar e manter atualizados, por partida e por time/temporada:
- Resultados históricos (placar completo, não só resultado 1x2) — mínimo 3 temporadas para calibrar o modelo
- Gols marcados/sofridos em casa e fora, separadamente (fundamental para Dixon-Coles)
- Escalação provável e desfalques (lesão, suspensão, D.M.)
- Posição/pontos na tabela, momento (últimos 5 jogos), motivação (briga por título, rebaixamento, jogo dead-rubber)
- Para Libertadores: contexto de mata-mata (ida/volta, gol fora não vale mais critério de desempate desde 2021 — confirmar regra vigente na temporada), viagens longas, altitude (times bolivianos/equatorianos, fator relevante e documentado estatisticamente)
- Odds de mercado (pelo menos de 2-3 casas) para comparar com sua probabilidade e calcular value

---

## 2. Modelo estatístico — o motor de probabilidade

### 2.1 Por que Poisson/Dixon-Coles

O modelo padrão da indústria para "quantos gols cada time faz" é modelar os gols de cada time como uma distribuição de **Poisson independente**, parametrizada pela força de ataque do time A, força de defesa do time B, e um fator de vantagem de mandante. É simples, é rápido, e é a base de praticamente todo sistema sério de previsão de futebol.

O problema da Poisson pura: ela **subestima sistematicamente placares baixos** (0-0, 1-0, 0-1, 1-1). O modelo **Dixon-Coles** (Dixon & Coles, 1997) corrige isso com um fator de correlação (ρ, "rho") aplicado só a esses 4 placares, e também introduz **ponderação temporal** (ξ, "xi") — jogos mais recentes pesam mais que jogos de 2 anos atrás, o que é bem relevante para você porque forma/elenco mudam bastante entre temporadas.

Parâmetros que o modelo estima por time, recalibrados periodicamente:
- **α (ataque)** — força ofensiva do time
- **β (defesa)** — força defensiva do time
- **γ (mando de campo)** — bônus de jogar em casa
- **ρ (rho)** — correção de placares baixos
- **ξ (xi)** — taxa de decaimento temporal (dá menos peso a jogos antigos)

Com isso você calcula λ_casa (gols esperados do mandante) e λ_fora (gols esperados do visitante), monta uma **matriz de probabilidades gols_casa × gols_fora** (tipicamente 0 a 6+ de cada lado) e daí tira tudo:
- **Placar exato**: probabilidade de cada célula da matriz (ex.: P(2-1) = 14%)
- **1X2**: soma das células onde casa > fora, empate, fora > casa
- **Over/Under gols**: soma das células conforme o total
- **Ambas marcam (BTTS)**: soma das células onde ambos os lados são ≥1
- **Handicap asiático**: idem, deslocando a matriz

### 2.2 Enriquecendo o modelo (fase 2)

Depois do MVP com Dixon-Coles "puro", os ganhos de precisão mais bem documentados vêm de:
1. **Usar xG (gols esperados) em vez de gols reais** como input de calibração — reduz ruído de sorte/azar em finalizações.
2. **Elo/power ratings** dinâmicos como camada complementar para checar consistência do 1X2 (bom para short-circuit quando o modelo Poisson diverge muito do consenso de mercado).
3. **Ajustes contextuais** (aplicados como pequenos multiplicadores documentados sobre α/β, não reescrevendo o modelo): desfalques importantes, mata-mata vs. jogo corrido, distância de viagem, altitude, dias de descanso entre jogos.
4. Calibração de **ρ e ξ específicos por competição** (Libertadores tem características diferentes do Brasileirão: mais jogos truncados, menos gols em média, mais peso de mando de campo por causa de viagens longas e altitude).

### 2.3 Exemplo de implementação (Python, roda como job/edge function)

```python
import numpy as np
from scipy.stats import poisson
from scipy.optimize import minimize

def dixon_coles_tau(x, y, lam, mu, rho):
    """Fator de correção para placares baixos (0-0,1-0,0-1,1-1)."""
    if x == 0 and y == 0:
        return 1 - lam * mu * rho
    elif x == 0 and y == 1:
        return 1 + lam * rho
    elif x == 1 and y == 0:
        return 1 + mu * rho
    elif x == 1 and y == 1:
        return 1 - rho
    return 1.0

def match_probability_matrix(alpha_home, beta_home, alpha_away, beta_away,
                              gamma, rho, max_goals=7):
    lam = alpha_home * beta_away * gamma   # gols esperados do mandante
    mu  = alpha_away * beta_home           # gols esperados do visitante
    matrix = np.zeros((max_goals, max_goals))
    for x in range(max_goals):
        for y in range(max_goals):
            tau = dixon_coles_tau(x, y, lam, mu, rho)
            matrix[x, y] = tau * poisson.pmf(x, lam) * poisson.pmf(y, mu)
    matrix /= matrix.sum()  # normaliza
    return matrix

# A partir da matriz:
# P(vitória casa) = soma onde x > y
# P(placar exato 2x1) = matrix[2, 1]
# P(over 2.5) = soma onde x + y > 2
```

O treino (estimar α/β/γ/ρ/ξ de todos os times via máxima verossimilhança) roda **uma vez por dia ou após cada rodada**, não a cada requisição — os parâmetros ficam guardados no banco e a matriz de probabilidade de um jogo específico é calculada on-demand a partir deles (rápido, é só multiplicação de matriz pequena).

### 2.4 Backtesting e calibração — não pule essa parte

Antes de confiar no sistema para apostar de verdade, valide contra dados históricos:
- **Log loss / Brier score** nas previsões de 1X2 e BTTS
- **RPS (Ranked Probability Score)** — métrica padrão da literatura acadêmica de futebol para avaliar previsões probabilísticas ordinais
- **Calibration plot**: entre os jogos em que você previu "60% de chance de vitória do mandante", o mandante venceu de fato ~60% das vezes? Se não, o modelo está mal calibrado e precisa de ajuste antes de qualquer uso real com dinheiro.
- Guarde **todas** as previsões (mesmo as não apostadas) versionadas por data de treino do modelo, para nunca comparar previsão com resultado usando dados que só existiam depois do jogo (data leakage).

---

## 3. Modelagem de dados no Supabase

Schema inicial (Postgres). Pensado para crescer: histórico completo, parâmetros de modelo versionados, previsões auditáveis, e odds de mercado para comparação.

```sql
-- Competições e temporadas
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
  id            bigint generated always as identity primary key,
  external_id   text unique,
  name          text not null,
  country       text,
  venue_altitude_m int  -- relevante para Libertadores (times de altitude)
);

-- Partidas
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

-- Parâmetros do modelo, versionados por data de treino
create table model_runs (
  id            bigint generated always as identity primary key,
  competition_id bigint references competitions(id),
  trained_at    timestamptz default now(),
  method        text,          -- 'dixon_coles_v1'
  xi            numeric,       -- decaimento temporal
  rho           numeric,       -- correção placares baixos
  notes         text
);

create table team_ratings (
  id            bigint generated always as identity primary key,
  model_run_id  bigint references model_runs(id),
  team_id       bigint references teams(id),
  attack        numeric not null,
  defense       numeric not null,
  home_advantage numeric  -- gamma, pode ser global ou por time
);

-- Previsões geradas (o output final, auditável)
create table predictions (
  id              bigint generated always as identity primary key,
  match_id        bigint references matches(id),
  model_run_id    bigint references model_runs(id),
  generated_at    timestamptz default now(),
  prob_home_win   numeric,
  prob_draw       numeric,
  prob_away_win   numeric,
  prob_btts_yes   numeric,
  prob_over_2_5   numeric,
  exact_score_probs jsonb,   -- { "1-0": 0.14, "2-1": 0.11, ... } matriz completa
  ai_context_summary text,   -- explicação em linguagem natural gerada pela LLM
  ai_adjustments  jsonb      -- ajustes contextuais aplicados e por quê, auditável
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

-- Seu histórico de apostas reais (para medir performance de verdade)
create table bets (
  id            bigint generated always as identity primary key,
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
```

Índices recomendados: `matches(kickoff_at)`, `matches(season_id, status)`, `predictions(match_id)`, `market_odds(match_id, market)`. Ative Row Level Security desde o início mesmo sendo uso pessoal — evita dor de cabeça se algum dia você expuser uma API pública ou compartilhar acesso.

---

## 4. Pipeline de ingestão e atualização (Supabase)

Fluxo sugerido, usando **Supabase Edge Functions + Supabase Cron (pg_cron)**, que hoje é a forma nativa de agendar jobs recorrentes direto no Postgres/Supabase sem precisar de infra externa ([supabase.com/docs/guides/functions/schedule-functions](https://supabase.com/docs/guides/functions/schedule-functions), [supabase.com/blog/supabase-cron](https://supabase.com/blog/supabase-cron)):

1. **Job diário (madrugada)** — `fetch_fixtures`: puxa jogos da rodada/fase atual de Brasileirão e Libertadores, upsert em `matches`.
2. **Job diário** — `fetch_results`: atualiza placares de jogos finalizados no dia anterior (`home_goals`, `away_goals`, `home_xg` se disponível).
3. **Job a cada poucas horas nos dias de jogo** — `fetch_lineups_injuries`: atualiza `match_lineups` com escalação provável/confirmada e desfalques — essa é a informação que a camada de IA vai usar para contexto.
4. **Job diário/pós-rodada** — `train_model`: recalcula α/β/γ/ρ/ξ com os resultados mais recentes, grava novo registro em `model_runs` + `team_ratings`. Pode rodar como Edge Function chamando um serviço Python (Supabase Edge Functions roda Deno/TS; para o treino estatístico em si, considere um worker Python separado — ex. um pequeno serviço em Fly.io/Render/Cloud Run chamado via webhook — porque bibliotecas científicas tipo `scipy`/`numpy` não rodam bem em Deno).
5. **Job antes de cada jogo (ex. 24h e 2h antes do kickoff)** — `generate_prediction`: monta a matriz de probabilidade com o `model_run` mais recente, aplica ajustes contextuais e chama a LLM para gerar o resumo explicativo, grava em `predictions`.
6. **Job intraday** — `fetch_market_odds`: captura odds atuais de 2-3 casas para alimentar `market_odds` e permitir o cálculo de value bet (diferença entre sua probabilidade e a probabilidade implícita da odd, descontando o overround da casa).

Para volumes maiores de scraping/transformação, vale usar o padrão **Edge Functions + Queues** que a própria Supabase documenta para jobs mais pesados ([supabase.com/blog/processing-large-jobs-with-edge-functions](https://supabase.com/blog/processing-large-jobs-with-edge-functions)), evitando timeout de function.

---

## 5. Camada de IA generativa — onde ela entra de verdade

Como mencionado na seção 0, a LLM **não gera a probabilidade**. As duas funções dela no sistema:

### 5.1 RAG de contexto qualitativo
Antes de cada jogo, monte um contexto estruturado (não deixe a LLM "pesquisar" livremente — isso convida alucinação) a partir dos seus próprios dados: últimos 5 jogos de cada time, desfalques confirmados (`match_lineups`), posição na tabela, e opcionalmente notícias recentes recuperadas via busca/RSS de fontes confiáveis (ex. sites de notícia esportiva, perfis oficiais dos clubes). Esse contexto é passado para a LLM como *grounding* — ela não inventa, ela resume o que está no banco.

### 5.2 Geração de explicação + ajuste contextual auditável
A LLM recebe: (a) a saída bruta do motor Dixon-Coles, (b) o contexto qualitativo do passo 5.1, e devolve dois outputs separados e ambos gravados em `predictions`:
- `ai_context_summary`: texto tipo "Palmeiras favorito (52% de vitória) mas joga sem o artilheiro Flaco López (suspenso); Vasco vem de 3 jogos sem perder fora de casa, o que reduz um pouco a confiança no modelo puro."
- `ai_adjustments`: um JSON pequeno e auditável tipo `{"home_attack_multiplier": 0.92, "reason": "ausência do artilheiro, média de 0.4 gols/jogo dele nas últimas 10 partidas"}` — nunca um ajuste "black box"; sempre com número + justificativa rastreável, para você poder decidir se aceita o ajuste ou fica só com o número puro do modelo estatístico.

Esse padrão (estatística faz a probabilidade "dura", LLM enriquece com contexto e explica em linguagem natural) é exatamente o que sistemas de produção na área vêm usando — o próprio caso de um motor de recomendação de apostas documentado publicamente separa claramente "a matemática" (nesse caso embeddings/similaridade) da "camada de LLM" que só adiciona narrativa e contexto por cima do resultado estatístico, sem substituí-lo ([mager.co/blog/2025-12-30-ai-recommendation-engine](https://www.mager.co/blog/2025-12-30-ai-recommendation-engine/)).

Sobre qual LLM usar: qualquer modelo Claude atual dá conta bem dessa tarefa (resumir contexto estruturado + gerar texto + devolver JSON de ajustes) — não precisa de nada especializado em apostas. O ponto crítico é o *prompt engineering*: force a LLM a sempre citar de qual dado do banco tirou cada afirmação, e trate qualquer ajuste numérico proposto por ela como sugestão a ser revisada, não como verdade absoluta.

---

## 6. Cálculo de value bet (comparando com o mercado)

Com `predictions` e `market_odds` no banco, o cálculo é direto:

```
prob_implícita_da_odd = 1 / odd
overround_da_casa = soma das prob_implícitas de todos os resultados do mercado (ex. 1X2) − 1
prob_implícita_ajustada = prob_implícita_da_odd / (1 + overround_da_casa)

value = (sua_probabilidade × odd) − 1
```

Se `value > 0`, em teoria a odd está "pagando mais" do que sua probabilidade estimada sugere que deveria — isso é o sinal de possível aposta de valor, não uma garantia de acerto naquele jogo específico (variância de amostra pequena continua alta; valor positivo só compensa em expectativa, ao longo de muitas apostas, e apenas se seu modelo estiver de fato bem calibrado).

---

## 7. Stack tecnológico sugerido

- **Banco/backend**: Supabase (Postgres + Auth + Edge Functions + Cron), como você já definiu
- **Worker de treino estatístico**: serviço Python separado (FastAPI simples) com `scipy`/`numpy`/`pandas`, hospedado em algo leve (Fly.io, Render, Cloud Run) — chamado via webhook pelas Edge Functions ou pelo próprio pg_cron via `pg_net`
- **IA generativa**: API da Anthropic (Claude) para a camada de contexto/explicação — dá pra chamar direto de uma Edge Function via HTTP
- **Frontend**: Next.js consumindo o Supabase diretamente (client SDK ou API própria) — dashboard com jogos do dia, probabilidades, placar exato, comparação com odds, e seu histórico de apostas/performance
- **Fonte de dados**: API-Football (Pro, US$19/mês) para começar

---

## 8. Roadmap sugerido

**Fase 1 — MVP (Brasileirão)**
Schema no Supabase, ingestão de fixtures/resultados via API-Football, modelo Dixon-Coles básico (sem xG, sem ajuste de IA ainda) treinado com histórico de 2-3 temporadas, cálculo de 1X2 + placar exato + over/under, dashboard simples mostrando as previsões da rodada.

**Fase 2 — Libertadores + camada de IA**
Adicionar Libertadores (atenção à estrutura de mata-mata: o modelo precisa considerar ida/volta como par correlacionado, não dois jogos independentes, além de fator altitude/viagem). Ligar a camada de RAG + LLM para contexto e explicações. Começar a capturar odds de mercado e calcular value bet.

**Fase 3 — Calibração e produto**
Backtesting sério (Brier score, RPS, calibration plot) sobre pelo menos uma temporada completa antes de levar a sério qualquer sinal de aposta. Registro de apostas reais (`bets`) para medir ROI de fato. Incorporar xG como input se a fonte de dados suportar. Refinar ρ/ξ por competição.

**Fase 4 — Expansão**
Outras ligas/competições, alertas automáticos de value bet, app mobile ou notificações.

---

## 9. Riscos e limitações a ter em mente

Vale registrar isso porque é fácil, no calor de montar o sistema, esquecer: nenhum modelo estatístico de futebol — nem os usados profissionalmente por casas de apostas com equipes inteiras dedicadas — chega perto de "prever com certeza" o resultado de uma partida individual. O objetivo realista de um sistema como esse é ter probabilidades **melhor calibradas** que uma estimativa informal, e identificar situações de possível valor frente ao mercado — não eliminar a variância inerente do esporte. Ainda existe o overround da casa de apostas jogando contra você em toda aposta, e mesmo um modelo bem calibrado perde dinheiro no curto prazo com frequência, por variância normal. Faz sentido tratar isso como um projeto de dados/engenharia sério, com backtesting rigoroso antes de qualquer uso com valores reais, e apostar (se apostar) com gestão de banca disciplinada — nunca acima do que você pode perder.

---

## Próximos passos práticos

1. Criar o projeto no Supabase e aplicar o schema da seção 3.
2. Assinar o plano Pro do API-Football e validar os endpoints de Brasileirão e Libertadores.
3. Implementar o worker Python com Dixon-Coles.
4. Rodar o backtest antes de plugar a camada de IA.

---

### Fontes consultadas

- [API-Football — Pricing](https://www.api-football.com/pricing)
- [SportMonks — Brasileirão API](https://www.sportmonks.com/football-api/brasileirao-api/)
- [football-data.org — Coverage](https://www.football-data.org/coverage)
- [Predicting Football Results With Statistical Modelling: Dixon-Coles and Time-Weighting](https://dashee87.github.io/football/python/predicting-football-results-with-statistical-modelling-dixon-coles-and-time-weighting/)
- [Dixon and Coles — penaltyblog documentation](https://docs.pena.lt/y/models/dixon_coles.html)
- [Dixon-Coles Model: Why Your Football Predictions Underrate Draws](https://statsultra.com/dixon-coles-model/)
- [Supabase — Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Supabase Cron](https://supabase.com/blog/supabase-cron)
- [Processing large jobs with Edge Functions, Cron, and Queues](https://supabase.com/blog/processing-large-jobs-with-edge-functions)
- [Building an AI Sports Betting Recommendation Engine with Gemma](https://www.mager.co/blog/2025-12-30-ai-recommendation-engine/)
