-- Assinatura por dono: trial de 7 dias na entrada, depois plano pago.
--
-- Uma linha por dono, criada no primeiro acesso (ver ensureSubscription em src/lib/billing.ts). O
-- estado vive aqui e não no gateway: o app precisa decidir "deixa publicar?" em toda varredura do
-- poller, e consultar a API do gateway a cada vez seria lento e frágil. O gateway avisa por webhook
-- quando algo muda (pagou, cancelou, falhou o cartão) e nós refletimos nesta tabela.
--
-- `status` é o que o app consulta:
--   trialing  — dentro dos 7 dias, acesso completo
--   active    — pagando
--   past_due  — cobrança falhou; ainda deixa entrar (o gateway tenta de novo por alguns dias)
--   canceled  — trial venceu sem pagar, ou cancelou. Só leitura: nada novo é publicado.
create table subscriptions (
  owner_id text primary key,
  status text not null default 'trialing' check (status in ('trialing','active','past_due','canceled')),
  trial_ends_at text not null,
  -- Id da assinatura no gateway (Stripe/Asaas/...). Null enquanto é só trial.
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end text,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- O poller varre por status pra decidir quem pode publicar.
create index idx_subscriptions_status on subscriptions (status);

-- O operador atual (dono de tudo que já existe) entra como assinante ativo permanente — é a conta
-- de quem opera a instalação, não um cliente em trial.
insert into subscriptions (owner_id, status, trial_ends_at, current_period_end)
values ('owner', 'active', '2099-01-01T00:00:00Z', '2099-01-01T00:00:00Z');
