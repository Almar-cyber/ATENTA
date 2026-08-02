-- Plano por dono: FREE permanente na entrada, PRO pago quando estourar os limites.
--
-- Por que free permanente e não trial: a pesquisa de mercado (02/08/2026) mostrou que a faixa de
-- R$ 0 está vazia no Brasil — nenhuma ferramenta BR com preço público tem plano gratuito de
-- verdade (o "grátis" do eKyte nem conecta canais). Free é a porta de entrada sem fricção de
-- cartão, e o custo de infra por usuário (~$0,016/mês medido) aguenta isso sem dor.
--
-- Uma linha por dono, criada no primeiro acesso (ensureSubscription em src/lib/billing.ts). O
-- estado vive aqui e não no gateway: o poller decide "deixa publicar?" em toda varredura, e
-- consultar a API do provedor a cada vez seria lento e frágil. O gateway avisa por webhook quando
-- algo muda e nós refletimos nesta tabela.
--
-- `plan` é o que o app consulta:
--   free      — permanente, com limites (1 conexão, 10 posts/mês). Nunca expira
--   trialing  — 14 dias experimentando o PRO (padrão do mercado: mLabs, Zoho, KingHost)
--   active    — pagando
--   past_due  — cobrança falhou; ainda publica (o gateway retenta por alguns dias)
--   canceled  — voltou pro free; os limites do free valem de novo
create table subscriptions (
  owner_id text primary key,
  plan text not null default 'free' check (plan in ('free','trialing','active','past_due','canceled')),
  -- Só faz sentido em 'trialing'; null nos demais.
  trial_ends_at text,
  -- Id no gateway (Mercado Pago/Stripe/...). Null enquanto nunca pagou.
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index idx_subscriptions_plan on subscriptions (plan);

-- O operador da instalação (dono de tudo que já existe) é ativo permanente — é quem opera, não um
-- cliente. Sem isso, o app de hoje cairia nos limites do free na primeira varredura.
insert into subscriptions (owner_id, plan, current_period_end)
values ('owner', 'active', '2099-01-01T00:00:00Z');
