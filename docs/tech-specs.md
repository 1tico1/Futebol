# Specs Técnicas Recomendadas — Sistema de Probabilidades de Apostas

Documento complementar à arquitetura. Aqui vai o "bill of materials" técnico: plano exato, tamanho de máquina, limites e custo de cada peça, dimensionado para o volume real de Brasileirão + Libertadores — nem sub nem superdimensionado.

**Premissa de escala usada nos cálculos:** ~10 jogos/rodada no Brasileirão (20 times, 380 jogos/temporada) + Libertadores em fase de mata-mata (poucos jogos por semana). Ou seja, um sistema de **baixo volume de dados, baixo volume de tráfego** — nada aqui exige infraestrutura pesada. O gargalo real do projeto é qualidade de dado e calibração de modelo, não poder de processamento.

---

## 1. Banco de dados — Supabase

| Item | Spec recomendada | Por quê |
|---|---|---|
| **Plano** | **Pro — US$25/mês** | Free não tem pg_cron/backups automáticos e pausa projeto após 7 dias de inatividade — inviável para um pipeline que roda todo dia. Pro já resolve tudo que este projeto precisa. |
| **Compute instance** | Micro (1 GB RAM, 2-core ARM, incluso nos US$10 de crédito do Pro) | Volume de escrita é baixo (algumas centenas de linhas/dia); Micro aguenta tranquilo. Só migre para Small/Medium se adicionar mais ligas simultâneas. |
| **Armazenamento de banco** | 8 GB inclusos (plano já cobre) | Estimativa de crescimento real abaixo (seção 6) — dá pra rodar **anos** dentro dos 8 GB. |
| **Egress/bandwidth** | 250 GB inclusos | Suficiente mesmo com dashboard consultando o banco o dia todo. |
| **Edge Function invocations** | 2.000.000/mês inclusos | Seu uso real fica na casa de 1.000–3.000 invocações/mês (jobs de cron). Folga enorme. |
| **pg_cron / Supabase Cron** | Disponível no Pro | É o que agenda os jobs de ingestão/treino/previsão descritos na arquitetura. |
| **Backups** | Point-in-time recovery (PITR) — ativar add-on se for guardar histórico de apostas real com dinheiro | Storage de dado de aposta merece backup point-in-time, é barato (~US$100/mês só se quiser PITR longo; para começar, backup diário incluso no Pro já é suficiente). |

**Quando fazer upgrade para Team (US$599/mês):** só se algum dia isso virar produto multiusuário com SLA — para uso pessoal/solo, nunca vai precisar.

---

## 2. Worker de treino do modelo estatístico (Python)

O treino do Dixon-Coles é **matematicamente leve**: você está otimizando algumas dezenas de parâmetros (2 por time × ~20-40 times + γ + ρ + ξ) via máxima verossimilhança com `scipy.optimize`, sobre um dataset de no máximo alguns milhares de linhas (partidas históricas). Isso roda em segundos, com uso de RAM na casa de dezenas de MB. Não é o tipo de carga que justifica GPU ou máquina grande.

| Item | Spec recomendada | Por quê |
|---|---|---|
| **Hosting** | **Render — plano Starter, US$7/mês** (512 MB RAM, 0.5 vCPU) | Cobre com folga o treino do modelo + geração de previsões. Escale para Standard (2 GB / 1 vCPU, US$25/mês) só se: (a) adicionar mais de ~5 competições simultâneas, ou (b) trocar Dixon-Coles por um modelo mais pesado (ex. gradient boosting com muitas features, redes neurais). |
| **Runtime** | Python 3.12, FastAPI (endpoint HTTP chamado pela Edge Function/cron) | Padrão simples, fácil de manter sozinho. |
| **Bibliotecas core** | `scipy`, `numpy`, `pandas`, `supabase-py` | Sem necessidade de PyTorch/TensorFlow nesta fase — só entra se você for para embeddings/xG com modelo próprio. |
| **Concorrência** | 1 worker é suficiente (job roda 1x/dia + antes de cada jogo, não é serviço de alto tráfego) | Sem necessidade de autoscaling nesta fase. |
| **Alternativas equivalentes** | Fly.io (`shared-cpu-1x`, 256MB, ~US$2-5/mês) ou Google Cloud Run (pay-per-use, praticamente centavos nesse volume) | Se quiser espremer custo ainda mais, Cloud Run com invocação sob demanda é a opção mais barata porque você paga só pelos segundos de execução do job, não por instância sempre ligada. |

**Recomendação prática:** comece no Fly.io ou Cloud Run (custo quase zero, ~US$2-5/mês) em vez de já pagar Render Standard. Só migre para algo maior se o job de treino passar a demorar minutos (sinal de que o dataset ou a complexidade do modelo cresceram bastante).

---

## 3. Fonte de dados esportivos — API-Football

| Item | Spec recomendada | Por quê |
|---|---|---|
| **Plano** | **Pro — US$19/mês (7.500 requisições/dia)** | Ver cálculo de budget abaixo — seu uso real fica entre 100-300 req/dia, então o Pro te dá ~25x de folga, o que é importante para não estourar em dias de rodada cheia ou se você adicionar mais competições depois. |
| **Budget de requisições estimado (dia sem jogo)** | Fixtures (2 calls, 1 por competição) + standings (2) + injuries/lineups de próximos jogos (~16) + odds (~15-30) ≈ **35-50 req/dia** | Dado de baixa frequência, cacheável. |
| **Budget de requisições estimado (dia de rodada, ~6-10 jogos)** | Base acima + resultado final por jogo (10) + estatísticas pós-jogo (10) + lineup confirmada 40min antes (10) ≈ **100-150 req/dia** | Ainda muito abaixo do limite do plano Pro. |
| **Boas práticas de economia de call** (usadas pela própria API-Football) | Verificar `coverage` da liga antes de chamar endpoints não suportados; cachear dados estáticos (times, treinadores) 1x/semana; só atualizar estatísticas ao vivo se o status do jogo for "1H/2H/ET"; usar `/fixtures/live` em vez de múltiplos endpoints separados | Reduz call desnecessário e deixa margem para picos. |
| **Quando subir para Ultra (US$29/mês, 75k req/dia)** | Só se você for adicionar in-play/live betting em tempo real (atualização a cada poucos segundos durante o jogo) ou expandir para 5+ competições | Não necessário no MVP. |

---

## 4. Camada de IA generativa — Claude API

Volume de uso aqui também é pequeno: você gera contexto/explicação **por partida**, não por usuário/sessão. Estimativa de jogos/mês: ~13-17 rodadas do Brasileirão (10 jogos cada) + poucos jogos de Libertadores em fase de mata-mata → **na faixa de 40-60 jogos processados por mês**, com 2 gerações por jogo (24h antes + atualização 2h antes) = **~80-120 chamadas/mês**.

| Item | Spec recomendada | Por quê |
|---|---|---|
| **Modelo para resumo/contexto (tarefa simples, alto volume relativo)** | **Claude Haiku 4.5** — ~US$1 / MTok input, ~US$5 / MTok output | Tarefa de sumarizar dados estruturados (lesões, forma recente) não exige o modelo mais caro. |
| **Modelo para explicação final + ajuste contextual (tarefa que importa mais)** | **Claude Sonnet 5** — ~US$2 / MTok input, ~US$10 / MTok output | Melhor raciocínio para justificar ajustes numéricos de forma consistente e auditável; ainda assim baratíssimo neste volume. |
| **Contexto por chamada** | ~1.500-2.500 tokens de input (stats estruturadas do seu banco + notícias resumidas), ~400-600 tokens de output | Não precisa do contexto de 1M tokens — mantenha o prompt enxuto e estruturado (JSON), isso também reduz alucinação. |
| **Custo mensal estimado** | **US$1-3/mês** no cenário realista (120 chamadas × ~2.000 tokens in + 500 out, misto Haiku/Sonnet) | Praticamente irrelevante no orçamento total do projeto — não economize na qualidade do prompt para "economizar tokens" aqui, o ganho não compensa. |
| **Prompt caching** | Ativar cache no bloco de "regras do sistema" (instruções fixas de como gerar o `ai_adjustments`) | Reduz ainda mais custo quando o mesmo prompt-base é reusado em várias chamadas seguidas. |

*Observação: confirme os preços exatos em [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) antes de orçar, porque tabela de preços de modelo muda com lançamentos novos — os valores acima são os vigentes hoje (ago/2026) para a linha Haiku/Sonnet.*

---

## 5. Frontend / Dashboard

| Item | Spec recomendada | Por quê |
|---|---|---|
| **Framework** | Next.js 15+ (App Router) | Ecossistema maduro, integra bem com Supabase client SDK, fácil de fazer SSR das previsões do dia. |
| **Hosting** | **Vercel Hobby (grátis)** para desenvolvimento/uso pessoal; **Vercel Pro (US$20/mês)** só se for domínio custom com uso comercial ou precisar de mais analytics/edge middleware | Tráfego de um dashboard pessoal é mínimo, Hobby aguenta numa boa. |
| **Autenticação** | Supabase Auth (já incluso no plano do banco) | Evita mais uma peça de infra separada. |

---

## 6. Estimativa de crescimento do banco (dimensionamento de armazenamento)

| Tabela | Linhas/temporada (BR + Libertadores) | Tamanho estimado/temporada |
|---|---|---|
| `matches` | ~500 | < 1 MB |
| `match_lineups` | ~25.000 (50 jogadores/jogo × 500 jogos) | ~3-5 MB |
| `market_odds` | ~20.000-30.000 (múltiplos mercados × bookmakers × snapshots) | ~5-8 MB |
| `predictions` (com JSONB da matriz de placar) | ~500-1.000 (múltiplas gerações por jogo) | ~2-4 MB |
| `team_ratings` / `model_runs` | poucas centenas | < 1 MB |

**Total estimado: ~15-20 MB por temporada.** Mesmo rodando 10+ anos acumulando histórico de múltiplas competições, você fica bem abaixo dos 8 GB inclusos no plano Pro — armazenamento **não é** um fator de custo relevante neste projeto.

---

## 7. Frequência de jobs (specs de agendamento)

| Job | Frequência recomendada | Ferramenta |
|---|---|---|
| `fetch_fixtures` | 1x/dia, 03h | Supabase Cron → Edge Function |
| `fetch_results` | 1x/dia, 07h (cobre jogos da noite anterior) | Supabase Cron → Edge Function |
| `fetch_lineups_injuries` | A cada 6h nos dias sem jogo; a cada 1h nas 6h antes do kickoff | Supabase Cron → Edge Function |
| `fetch_market_odds` | 3x/dia (manhã, tarde, 2h antes do jogo) | Supabase Cron → Edge Function |
| `train_model` | 1x/dia (madrugada) ou logo após o fim de cada rodada | Supabase Cron → webhook para o worker Python |
| `generate_prediction` | 24h antes do kickoff + atualização 2h antes | Supabase Cron → webhook para worker Python + Claude API |

---

## 8. Custo mensal total estimado (MVP, Brasileirão + Libertadores)

| Item | Custo/mês |
|---|---|
| Supabase Pro | US$25 |
| API-Football Pro | US$19 |
| Worker Python (Fly.io/Cloud Run, uso baixo) | US$2-7 |
| Claude API (Haiku + Sonnet, ~120 chamadas/mês) | US$1-3 |
| Frontend (Vercel Hobby) | US$0 |
| Domínio (opcional, anualizado) | ~US$1 |
| **Total** | **≈ US$48-55/mês** |

Esse é um projeto barato de operar — o custo não é o fator limitante aqui, é o tempo de calibração e validação do modelo antes de confiar nele com dinheiro real.

---

## 9. Segurança e confiabilidade (specs não-negociáveis mesmo em projeto pessoal)

- **Row Level Security (RLS)** ativado em todas as tabelas desde o dia 1, mesmo em projeto solo — evita retrabalho se um dia você expuser uma API pública ou compartilhar com alguém.
- **Chaves de API** (API-Football, Claude) apenas em variáveis de ambiente do lado servidor (Edge Functions/worker), nunca no client Next.js.
- **Backup diário automático** (incluso no Supabase Pro) — ativar PITR se passar a registrar apostas reais com valores relevantes.
- **Log de execução dos cron jobs** (tabela simples `job_runs` com status/erro) — importante porque falha silenciosa de ingestão é o tipo de bug que corrompe a qualidade dos dados sem você perceber até já ter afetado várias previsões.

---

## 10. Gatilhos de upgrade (quando repensar as specs)

- **Supabase Micro → Small**: se o job de treino do modelo começar a competir por recursos com queries do dashboard em horário de pico (ex. antes de uma rodada cheia).
- **Render/Fly Starter → Standard**: se adicionar mais de ~5 competições simultâneas ou trocar para um modelo estatístico mais pesado (ex. features de xG com regressão mais complexa).
- **API-Football Pro → Ultra**: se for para dados ao vivo minuto a minuto (in-play).
- **Claude Haiku → Sonnet em tudo**: se perceber que os resumos/ajustes contextuais do Haiku estão rasos ou inconsistentes — dado o custo residual, não há problema em já começar direto com Sonnet 5 em tudo, se preferir simplicidade a economia de centavos.

---

### Fontes consultadas

- [Supabase — Pricing](https://supabase.com/pricing)
- [Render — Pricing](https://render.com/pricing)
- [Claude API — Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [API-Football — How to save calls to the API](https://www.api-football.com/news/post/how-to-save-calls-to-the-api)
- [API-Football — Pricing](https://www.api-football.com/pricing)
