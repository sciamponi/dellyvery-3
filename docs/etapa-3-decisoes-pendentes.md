# Etapa 3 — Decisões pendentes para aprovação do responsável

> **Status:** APROVADO COM PENDÊNCIAS. Nenhuma implementação realizada.
> **Aprovação:** 2026-10-31, conforme respostas do responsável registradas abaixo.
> **Fonte:** `docs/etapa-3-remediacao-assinaturas-quotas.md` (seção 8).
> **Repositório:** `dellyvery-3` — branch `feat/supabase-foundation`, commit `3f1e026`.
> **Data:** 2026-10-31.
> **Regra:** este documento não altera o documento original, não cria código,
> migrations, testes ou dados, e não inventa valores comerciais.

## Como ler esta lista

Cada decisão traz:

1. **ID e título**
2. **O que precisa ser decidido**
3. **Recomendação** — técnica ou de produto, sempre identificada
4. **Consequência de cada alternativa**
5. **Risco de implementar sem a decisão**
6. **Bloqueio** — se impede a primeira migration, se pode esperar até o gate/backfill
   ou se pode ficar para uma fase posterior

As recomendações respeitam as regras já confirmadas: ciclo a partir da ativação e
com a duração configurada no plano; carência configurável no Painel Master; Pix/QR
com confirmação manual antes da ativação; Asaas apenas como possibilidade futura;
um CPF associado a somente uma empresa; `trial_days=0` mantém o fluxo de teste; e
nenhum valor comercial inventado.

---

## Resumo executivo

- **Total de decisões:** 12.
- **Bloqueadoras:** 10.
  - **8 bloqueiam a primeira migration** (ou o desenho mínimo dela):
    decisões 1, 2, 4, 5, 7, 9, 10 e 12.
  - **2 bloqueiam a ativação do gate de acesso e o backfill:**
    decisões 3 e 8.
- **Podem ficar para fase posterior:** 2 (decisões 6 e 11).

**Riscos que precisam estar resolvidos antes da primeira migration:**

1. O que cada estado significa (trial, gratuito, pago, pendente, carência,
   cancelado até o fim) — evita criar colunas e funções com semântica errada.
2. Quem o CPF representa e como ele será armazenado — evita bloquear equipes,
   duplicar CPF ou expor dado pessoal.
3. Onde ficam a chave Pix e o QR Code — evita segredo no frontend ou tabela
   pública.
4. Quais campos a confirmação manual exige — evita retrabalho na tabela de
   solicitações.
5. Quem pode confirmar pagamento e alterar carência — define RLS, grants e
   auditoria desde o início.
6. Como a carência é registrada — snapshot por concessão evita mudança
   retroativa.
7. Como o legado sem CPF/duplicado será tratado — evita migration que falha ou
   bloqueia empresas em massa.

---

## Registro de aprovação

Em **2026-10-31** o responsável aprovou as 12 decisões. O quadro abaixo registra
o que está fechado e o que ainda precisa ser detalhado antes da implementação
correspondente.

| # | Status | Decisão registrada |
|---|---|---|
| 1 | Aprovada | `access_days` canônico; renovação estende de `max(now(), expires_at)`. |
| 2 | Aprovada | Não inferir gratuidade pelo preço; criar marca explícita de plano gratuito. |
| 3 | Aprovada | Campo numérico configurável no Painel Master; valor inicial definido pelo responsável; snapshot por concessão. |
| 4 | Aprovada | Tabela restrita + RPC; Pix fixo configurado pelo Master na primeira versão. |
| 5 | Aprovada com pendência | Confirmação manual por `PLATFORM_ADMIN`, referência obrigatória e auditoria; detalhes de comprovante, expiração e estorno antes da implementação da compra. |
| 6 | Aprovada | Asaas adiado para fase posterior. |
| 7 | Aprovada com pendência | CPF do OWNER/responsável; CNPJ separado; obrigatoriedade definida antes da implementação. |
| 8 | Aprovada | Coluna opcional, unicidade parcial e estado de regularização; não bloquear legado automaticamente. |
| 9 | Aprovada com pendência | Tabela restrita, hash para unicidade, máscara e acesso auditado; estratégia de proteção detalhada antes da migration. |
| 10 | Aprovada | Trial com `expires_at=now()`, estado “teste expirado” e sem acesso. |
| 11 | Aprovada | Quotas em fase posterior, começando com aviso antes do bloqueio. |
| 12 | Aprovada | Somente `PLATFORM_ADMIN` confirma pagamentos e edita carência, com auditoria obrigatória. |

### Pendências antes de implementar

1. **Decisão 5 (compra):** definir se o comprovante/anexo será obrigatório,
   qual o prazo de expiração da solicitação pendente e qual a política de
   cancelamento/estorno.
2. **Decisão 7 (CPF):** definir quando o CPF passa a ser obrigatório no
   onboarding e qual o tratamento para novos cadastros antes dessa data.
3. **Decisão 9 (CPF):** detalhar a estratégia de proteção (criptografia em
   repouso, quem vê o CPF completo, retenção e resposta a incidentes).

### Sequência recomendada

1. **Onda de assinatura:** modelo de estados, duração, trial de 0 dias,
   plano gratuito, carência com valor inicial `0` e permissões Master
   (decisões 1, 2, 3, 10 e 12). Pode começar sem CPF e sem compra.
2. **Onda de CPF:** somente após detalhar as decisões 7 e 9.
3. **Onda de compra/Pix:** somente após detalhar a decisão 5.
4. **Ondas posteriores:** legado/backfill (decisão 8), quotas (11) e Asaas (6).

---

## Pendências da correção local do Gate 4 (2026-11-04)

Estas pendências foram registradas durante a correção local dos bloqueadores do
Gate 4. Nenhuma decisão comercial abaixo foi presumida.

1. **Migrations pendentes:** há **24 migrations locais pendentes**, de
   `20261106000000` a `20261123000000`; a última é o lote 12 do runbook. Antes de
   qualquer publicação, confirmar no remoto que `20261109_01`, `20261113`,
   `20261114`, `20261114_01` e `20261115` continuam pendentes, que
   `20261123000000` ainda não foi aplicada e qual é o histórico real. A correção
   editou apenas migrations tratadas como pendentes pelo runbook; não houve
   acesso ao Supabase hosted.
2. **Event trigger:** se o runner não puder executar como superuser, o event
   trigger `dellyvery3_revoke_new_function_acl` não será criado. A migration
   passa a registrar aviso em vez de falhar. Decidir se o trigger será instalado
   manualmente como `supabase_admin` ou se o default ACL é suficiente.
3. **Reutilização de referência:** o registry mantém a referência confirmada
   mesmo após rejeição, cancelamento ou eventual estorno. Decidir se haverá
   liberação manual de referência e em qual processo.
4. **Comprovante:** a validação agora exige `http/https` e limita a 1000
   caracteres. Continuam pendentes a obrigatoriedade do comprovante, o prazo de
   expiração da solicitação e a política de cancelamento/estorno.
5. **`rejected_by`:** a FK passou a `ON DELETE RESTRICT`. Decidir se perfis com
   histórico de rejeição serão anonimizados/retidos em vez de excluídos.
6. **Pix parcial:** `set_platform_pix_settings` preserva campos omitidos;
   `patch_platform_pix_settings` permite limpar campos com `null`. Confirmar o
   contrato desejado para a UI e para integrações futuras.
7. **Runner transacional:** `BEGIN/COMMIT` explícitos foram removidos de
   `20261114`/`20261114_01`. Confirmar que o runner usado aplica cada migration
   em transação; a `20261113` agora bloqueia reexecução após as migrations
   financeiras.
8. **`manage_subscription`:** continua sem `service_role`, por efeito do
   hardening de ACL. Decidir se algum backend precisa desse acesso.
9. **Carência e plano gratuito:** continuam pendentes a cobertura de
   `pendente/suspenso` e a decisão sobre plano gratuito ignorar `expires_at`.
10. **CORS de `reseller-approve`:** o fallback de origem não foi alterado nesta
    fase; decidir a política de `APP_ORIGIN` antes de publicar Edge Functions.
11. **Backup/restore:** o backup de 2026-11-04 teve restore isolado **PASS**
    (duas execuções, contagens e checksums sem diferenças). A publicação continua
    bloqueada até gerar um backup novo imediatamente antes da aplicação e
    reconfirmar o estado remoto. O `manifest.json` mantém os campos de restore
    como `pending`; o relatório separado é a evidência autoritativa e o manifesto
    não deve ser editado retroativamente.

---

## Decisão 1 — D1-A: duração canônica e base de renovação

**O que precisa ser decidido**

- `plans.access_days` passa a valer para planos diretos e de revenda?
- Na renovação, o novo período começa em `now()` ou continua a partir do
  vencimento atual?
- O que fazer com planos antigos que estão sem `access_days`?

**Recomendação (técnica + produto)**

Usar `access_days` como fonte única da duração, tanto para venda direta quanto
para revenda. Ativação nova começa em `now()` e vence em
`now() + access_days`. Renovação estende a partir de `max(now(), expires_at)`,
preservando o tempo que o cliente já pagou. Plano sem `access_days` não pode ser
ativado como pago até o Master configurar. Não deduzir duração de
`billing_cycle` (mensal/anual), porque isso voltaria ao mês calendário e violaria
a regra confirmada.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Usar `billing_cycle` (mensal = 30, anual = 365) | Simples, mas ignora a duração configurada e pode contrariar D1. |
| B. Renovação reinicia em `now()` | Fácil de explicar, mas o cliente perde dias se renovar antes do vencimento. |
| C. Renovação estende de `max(now(), expires_at)` | Preserva o tempo pago; é o padrão já usado na revenda. **Recomendada.** |

**Risco de implementar sem decidir**

Datas de vencimento erradas, perda de dias pagos, retrabalho na função de
ativação e nova migration corretiva.

**Bloqueio**

**Bloqueia a primeira migration.** Define o cálculo de `started_at/expires_at` e
o contrato da RPC de ativação.

---

## Decisão 2 — D1-B: o que é “plano gratuito”

**O que precisa ser decidido**

- O plano `solo` (preço `0`) é gratuito permanente ou é apenas o plano usado no
  trial?
- Plano gratuito tem data de validade ou não expira?
- Como diferenciar “gratuito” de “trial vencido”?

**Recomendação (produto + técnica)**

Não tratar “preço `0`” como sinal automático de plano gratuito. Manter o `solo`
como plano de entrada/trial e, se o produto quiser um plano gratuito permanente,
criar uma marca explícita (por exemplo, `origin='free'` ou campo equivalente) e
definir que ele não expira. Assim, trial e gratuito deixam de se confundir.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Preço `0` = gratuito permanente | Simples, mas todo trial vira gratuito e o gate de expiração perde sentido. |
| B. Plano gratuito explícito, separado do trial | Modelo mais claro; exige decisão comercial e talvez um novo plano no catálogo. **Recomendada.** |
| C. Não ter plano gratuito | Menos casos de estado; o trial precisa de outro plano de entrada. |

**Risco de implementar sem decidir**

Usuário com trial vencido continuar com acesso como se fosse gratuito, ou plano
gratuito ser bloqueado por engano.

**Bloqueio**

**Bloqueia a primeira migration.** O estado “gratuito” precisa existir no modelo
antes de a função de acesso ser escrita.

---

## Decisão 3 — D3: regras e valor da carência

**O que precisa ser decidido**

- Qual é o valor da carência (será preenchido no Painel Master; não definir aqui)?
- Existe teto máximo?
- A contagem começa no vencimento ou na data da concessão?
- Vale para trial vencido, assinatura cancelada e pedido de compra pendente?
- Empresas antigas recebem carência retroativa? A partir de quando?

**Recomendação (produto + técnica)**

Criar a configuração global com valor inicial `0` e registrar cada concessão em
uma tabela com “foto” do valor usado (`grace_days`, `grace_until`,
`granted_at`). O valor em si fica para o Master definir depois. Recomendação
técnica: contar a partir do vencimento; conceder carência a empresas diretas
depois de um período válido (trial ou pago) terminar; não conceder carência a
quem nunca pagou e está apenas com compra pendente, para não premiar
inadimplência. Para empresas antigas, conceder na janela de backfill e registrar
o snapshot.

**Contexto insuficiente:** o documento não define valor, teto nem política para
pedido pendente. Esses pontos são comerciais e não podem ser inferidos.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Carência global “atual”, sem snapshot | Simples, mas mudar o campo depois altera o prazo de quem já recebeu. |
| B. Snapshot por concessão | Auditável e justo; mais uma tabela e um passo no backfill. **Recomendada.** |
| C. Carência por plano | Não atende à regra de configuração global no Painel Master. |

**Risco de implementar sem decidir**

Bloquear todas as empresas diretas de uma vez, conceder acesso indefinido ou
mudar prazos já concedidos sem auditoria.

**Bloqueio**

**Bloqueia o gate de acesso e o backfill**, não necessariamente a primeira
migration. A tabela de configuração e a de concessões podem ser criadas com
valor `0`; o valor e o alcance precisam estar definidos antes de ligar o gate.

---

## Decisão 4 — D5-A: onde guardar Pix/QR e quem pode ver

**O que precisa ser decidido**

- A chave Pix e o QR Code ficam em configuração do banco (com acesso restrito) ou
  em segredo de Edge Function?
- O QR é fixo, configurado pelo Master, ou gerado por solicitação?
- Quem pode visualizar: só o dono da solicitação, todos os membros da empresa ou
  também o Master?

**Recomendação (técnica + produto)**

Guardar a configuração em uma tabela restrita (por exemplo,
`platform_settings`), nunca no código nem no bundle do frontend. Entregar as
instruções por RPC autenticada apenas para o OWNER/ADMIN que abriu a solicitação;
o Master pode ver para conferência. Para a primeira versão, QR fixo configurado
pelo Master é mais simples e suficiente para confirmação manual; QR por
solicitação fica para quando houver integração automática.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Tabela restrita + RPC | Simples, auditável e sem segredo no cliente. **Recomendada.** |
| B. Edge secret + Edge Function | Mais protegido, porém exige mais operação e uma função só para isso. |
| C. Chave fixa no código/frontend | Inaceitável: expõe dado e exige deploy para trocar. |

**Risco de implementar sem decidir**

Expor chave/QR publicamente, mostrar instruções erradas ou ter de refazer a
tabela quando a integração automática chegar.

**Bloqueio**

**Bloqueia a primeira migration da compra de plano.** Define onde os dados ficam
e como a tela os recebe.

---

## Decisão 5 — D5-B: regras da confirmação manual

**O que precisa ser decidido**

- A confirmação exige comprovante/anexo ou apenas uma referência de pagamento?
- Uma pessoa do Master basta ou são necessárias duas confirmações?
- A solicitação pendente expira? Em quanto tempo?
- Qual a política de cancelamento e estorno?

**Recomendação (produto + técnica)**

Exigir uma referência de pagamento (texto livre: comprovante, ID Pix,
observação). Anexo pode ser opcional se o produto quiser. Para a primeira
versão, uma confirmação de `PLATFORM_ADMIN` com auditoria é suficiente;
dupla confirmação pode entrar depois, se o volume ou o risco exigirem. O prazo de
expiração da solicitação deve ser configurável; não fixar um número sem decisão
comercial. Cancelamento/estorno precisam de regra explícita do produto.

**Contexto insuficiente:** o documento não define política de comprovante,
dupla conferência, prazo ou estorno.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Uma confirmação + referência + auditoria | Rápida e simples; depende da conferência humana. **Recomendada para v1.** |
| B. Duas confirmações | Mais segura contra fraude; mais lenta e exige mais de um Master. |
| C. Sem referência obrigatória | Menos atrito, mas dificulta conciliação e auditoria. |

**Risco de implementar sem decidir**

Ativação duplicada, fraude na confirmação, solicitações antigas esquecidas ou
tabela sem os campos necessários.

**Bloqueio**

**Bloqueia a primeira migration da compra de plano.** Define os campos e o fluxo
de confirmação.

---

## Decisão 6 — D5-C: escopo e momento do Asaas

**O que precisa ser decidido**

- O Asaas será integrado? Quando?
- A integração vale só para assinatura ou também para pedidos?
- Qual preparação mínima deve existir agora sem implementar a integração?

**Recomendação (técnica + produto)**

Adiar a integração. Preparar apenas campos opcionais e genéricos
(`provider`, `external_customer_id`, `external_payment_id`) e uma tabela de
eventos idempotentes, sem afirmar que o Asaas existe. A escolha de fornecedor,
escopo e momento é comercial e pode ser feita depois.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Integrar agora | Custo e dependência de contrato/credenciais ainda não confirmados. |
| B. Só preparar o modelo genérico | Evita retrabalho sem prometer integração. **Recomendada.** |
| C. Ignorar totalmente | Pode exigir mudança de tabela quando a integração chegar. |

**Risco de implementar sem decidir**

Criar integração prematura, assumir credenciais inexistentes ou acoplar o sistema
a um fornecedor antes da decisão comercial.

**Bloqueio**

**Pode ficar para fase posterior.** Não impede a primeira migration nem o fluxo
manual com Pix.

---

## Decisão 7 — D7-A: quem o CPF representa

**O que precisa ser decidido**

- A regra “um CPF, uma empresa” vale para o CPF do OWNER/responsável ou para
  qualquer pessoa vinculada à empresa?
- CNPJ também entra na regra?
- O CPF será obrigatório já no onboarding ou em uma campanha posterior?

**Recomendação (produto + técnica)**

Aplicar a regra ao CPF do OWNER/responsável. Funcionários e membros da equipe
continuam podendo participar de várias empresas, como já ocorre em
`company_members`. CNPJ pode ser uma regra separada, se o produto quiser. Tornar
o CPF obrigatório no onboarding depois de o modelo existir e de haver uma
campanha para os legados; exigir de imediato bloquearia contas antigas.

**Contexto insuficiente:** o documento não define CNPJ nem o momento de
obrigatoriedade.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Qualquer CPF vinculado à empresa | Pode impedir um funcionário de trabalhar em duas empresas; conflita com memberships. |
| B. CPF do OWNER/responsável | Atende à regra sem quebrar equipes. **Recomendada.** |
| C. OWNER + CNPJ | Mais completo, porém exige mais campos e regras de decisão. |

**Risco de implementar sem decidir**

Criar unicidade no lugar errado, bloquear funcionários ou permitir que o mesmo
responsável abra várias empresas.

**Bloqueio**

**Bloqueia a primeira migration do CPF.** Define a entidade, a chave única e a
RLS.

---

## Decisão 8 — D7-B: tratamento de legado sem CPF ou com CPF duplicado

**O que precisa ser decidido**

- O que fazer com empresas que não têm CPF?
- O que fazer quando o mesmo CPF aparece em mais de uma empresa?
- Haverá bloqueio durante a pendência? Qual o prazo de regularização?

**Recomendação (produto + técnica)**

Criar a coluna/entidade como opcional, com índice único apenas para CPF
preenchido. Empresas sem CPF ficam em estado “pendente de regularização”, sem
bloqueio imediato. Duplicidades são resolvidas manualmente, com registro em
auditoria e sem expor o CPF. O prazo e a eventual suspensão são decisão do
produto; não inventar prazo.

**Contexto insuficiente:** o documento não define prazo, comunicação ou política
de bloqueio.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Bloquear todo legado sem CPF agora | Aplicação imediata da regra, mas risco de bloquear empresas em massa. |
| B. Estado pendente + regularização gradual | Seguro para a operação; a regra só fica completa depois. **Recomendada.** |
| C. Ignorar legado | A regra nunca é aplicada de fato. |

**Risco de implementar sem decidir**

Migration falhar por duplicidade, bloquear clientes antigos ou manter a regra
ineficaz.

**Bloqueio**

**Bloqueia o backfill e a ativação do gate de CPF.** A modelagem pode começar
antes, mas a aplicação da unicidade não.

---

## Decisão 9 — D7-C: privacidade e armazenamento do CPF

**O que precisa ser decidido**

- O CPF fica em texto, hash ou criptografado?
- Quem pode ver o CPF completo no Painel Master?
- O CPF aparece em logs, mensagens de erro ou telas de outros membros?

**Recomendação (técnica + produto)**

Guardar o CPF em tabela separada e restrita, com os dígitos normalizados para a
regra de unicidade e um hash para comparação. Exibir apenas versão mascarada
para a maioria das telas; o CPF completo só por RPC auditada para o Master ou
para o próprio responsável. Nunca gravar CPF em `audit_logs`, URLs, mensagens de
erro ou logs. Criptografia em repouso depende da infraestrutura e deve ser
decidida com segurança.

**Contexto insuficiente:** o documento não define política de segurança/LGPD nem
quem pode ver o CPF completo.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Texto em `companies` | Simples, mas expõe o CPF a todos que leem a empresa e ao storefront. |
| B. Tabela restrita + máscara + hash | Equilíbrio entre regra, operação e privacidade. **Recomendada.** |
| C. Só hash | Mais privado, mas impede exibir o CPF para conferência. |

**Risco de implementar sem decidir**

Vazamento de dado pessoal, RLS mal desenhada, dificuldade de corrigir depois e
risco jurídico.

**Bloqueio**

**Bloqueia a primeira migration do CPF.** Define tabela, RLS e forma de
armazenamento.

---

## Decisão 10 — D8: comportamento do trial de 0 dias

**O que precisa ser decidido**

- Com `trial_days=0`, o cliente tem acesso operacional zero ou algum acesso
  mínimo de teste?
- Como mostrar “teste iniciado” sem parecer plano gratuito?
- O trial de 0 dias pode ser renovado ou vira cobrança imediatamente?

**Recomendação (produto + técnica)**

Criar o registro de trial com `started_at=now()`, `expires_at=now()` e
`origin='trial'`, mantendo o status `trial`. O estado derivado mostra
“teste iniciado/expirado” e não concede acesso operacional, salvo se o produto
definir limites explícitos de teste. Não tratar como plano gratuito nem como
pagamento pendente. Se o produto quiser acesso mínimo, os limites precisam ser
definidos; não inventar.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Trial de 0 dias = registro de teste sem acesso | Respeita “0 dias” e mantém o fluxo de teste. **Recomendada.** |
| B. Trial de 0 dias = acesso mínimo limitado | Mais acolhedor, mas exige definir limites e pode confundir com gratuito. |
| C. Trial de 0 dias = plano gratuito | Contradiz a separação entre teste e gratuito. |

**Risco de implementar sem decidir**

`trial_days=0` não funcionar, usuário cair direto em plano gratuito ou ficar sem
saber por que não tem acesso.

**Bloqueio**

**Bloqueia a primeira migration.** Define o estado de trial e a função de acesso.

---

## Decisão 11 — Q1: quais quotas aplicar e com que severidade

**O que precisa ser decidido**

- Quais limites de `plans.limits` serão realmente aplicados?
- O limite bloqueia ou apenas avisa?
- O que fazer com empresas que já estão acima do limite?

**Recomendação (produto + técnica)**

Deixar o enforcement para uma fase posterior. Primeiro exibir uso e avisos
(“soft limit”); aplicar bloqueio só depois de definir os limites comerciais e
tratar os excedentes atuais. Se o bloqueio for aprovado, o desenho técnico
precisa de reserva atômica para não estourar em concorrência.

**Contexto insuficiente:** o documento não define quais limites são comerciais
nem a severidade desejada.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Bloquear tudo agora | Protege a receita, mas pode parar operações existentes. |
| B. Aviso primeiro, bloqueio depois | Menos risco operacional; a proteção demora. **Recomendada.** |
| C. Não aplicar quotas | Nenhuma proteção de limite. |

**Risco de implementar sem decidir**

Quebrar a operação de clientes atuais ou criar um controle que nunca é usado.

**Bloqueio**

**Pode ficar para fase posterior.** Não impede a primeira migration de
assinatura.

---

## Decisão 12 — M1: quem confirma pagamento e altera carência

**O que precisa ser decidido**

- Quem pode confirmar pagamento: qualquer `PLATFORM_ADMIN` ou um papel específico?
- Quem pode alterar o campo de carência?
- A confirmação exige motivo/auditoria? Haverá segregação de função ou dupla
  aprovação?

**Recomendação (produto + técnica)**

Restringir confirmação de pagamento e edição de carência a `PLATFORM_ADMIN`,
com auditoria obrigatória (ator, data, valor anterior, valor novo, motivo).
Para a primeira versão, um Master com auditoria é suficiente; dupla aprovação
pode ser adicionada depois, se o risco exigir. Não permitir que o próprio
cliente confirme o pagamento.

**Contexto insuficiente:** o documento não define a equipe Master nem papéis
internos.

**Alternativas e consequências**

| Alternativa | Consequência |
|---|---|
| A. Qualquer `PLATFORM_ADMIN` | Simples; depende de controle interno. **Recomendada para v1.** |
| B. Papel específico de financeiro | Mais controle; exige novo papel/permissão. |
| C. Dupla aprovação | Máxima segurança; mais lento e mais complexo. |

**Risco de implementar sem decidir**

Pessoa sem autorização confirmar pagamento ou mudar carência, e falta de trilha
para auditoria.

**Bloqueio**

**Bloqueia a primeira migration.** Define RLS, grants e campos de auditoria.

---

## Modelo curto de resposta (referência)

As respostas já recebidas estão registradas na seção **Registro de aprovação**.
O modelo abaixo fica como referência de formato para eventuais revisões.

```text
1 (D1-A, duração/renovação):
2 (D1-B, plano gratuito):
3 (D3, carência):
4 (D5-A, Pix/QR):
5 (D5-B, confirmação manual):
6 (D5-C, Asaas):
7 (D7-A, escopo do CPF):
8 (D7-B, legado sem/duplicado):
9 (D7-C, privacidade do CPF):
10 (D8, trial de 0 dias):
11 (Q1, quotas):
12 (M1, quem confirma/altera):
```

Exemplo de preenchimento:

```text
1: aprovo a recomendação
2: prefiro a alternativa B
3: preciso definir o valor no Painel Master
4: aprovo a recomendação
5: aprovo a recomendação, mas quero anexo obrigatório
6: pode ficar para depois
7: aprovo a recomendação
8: aprovo a recomendação
9: aprovo a recomendação
10: aprovo a recomendação
11: pode ficar para depois
12: aprovo a recomendação
```

---

## Confirmação do estado do Git

**Antes desta etapa:** `git status --porcelain` retornava **75** alterações
locais (23 arquivos modificados e 52 não rastreados), incluindo o documento
`docs/etapa-3-remediacao-assinaturas-quotas.md` criado na etapa anterior. Branch
`feat/supabase-foundation`, commit `3f1e026`.

**Durante esta etapa:**

- O documento original `docs/etapa-3-remediacao-assinaturas-quotas.md` **não foi
  alterado**.
- Nenhum código, migration, configuração, teste ou banco foi alterado.
- Nenhum comando com escrita de dados, commit, push ou deploy foi executado.
- Nenhum valor comercial foi inventado.

**Depois desta etapa:** a única divergência esperada é a criação deste documento
(`docs/etapa-3-decisoes-pendentes.md`). As 75 alterações anteriores permanecem
intactas; o total esperado passa a 76 (23 modificados + 53 não rastreados). O
estado final deve ser confirmado com `git status --porcelain` antes de qualquer
aprovação.

---

## Conclusão

As 12 decisões foram aprovadas em 2026-10-31. Permanecem três detalhes antes
das ondas correspondentes: política da compra manual (decisão 5), momento de
obrigatoriedade do CPF (decisão 7) e estratégia de proteção do CPF (decisão 9).
A onda de assinatura pode começar sem esses três detalhes; CPF e compra/Pix não.

---

## Implementação da onda 1 (2026-10-31)

Aprovadas as decisões 1, 2, 3, 10 e 12, foi iniciada a onda de assinatura.

**Migrations criadas e aplicadas localmente**

- `supabase/migrations/20261117000000_dellyvery3_subscription_state_wave1.sql`
- `supabase/migrations/20261117000001_dellyvery3_is_platform_admin_stable.sql`

A primeira adiciona `plans.is_free`, `subscriptions.canceled_at`,
`platform_settings` (carência e gate), `company_grace_grants`, a função de estado
`subscription_access_state`, a RPC `get_company_subscription_state`, as RPCs de
configuração Master e ajusta `company_has_active_access` e
`create_company_with_owner` para respeitar `trial_days = 0` e plano gratuito
explícito. A segunda marca `is_platform_admin()` como `stable`, eliminando o
aviso do `supabase db lint`.

**Código e UI**

- `src/api/plans.js` e `src/api/plans.test.js`: campo `is_free`.
- `src/api/subscriptionSettings.js` e `src/api/subscriptionSettings.test.js`:
  leitura/gravação da carência e do gate, além de concessão de carência.
- `src/hooks/useSubscription.js`: `isFree`, `expiresAt`, `expiresInFuture` e
  `hasAccess` alinhado ao novo estado.
- `src/pages/Assinatura.jsx`: estado de trial vencido, plano gratuito e ausência
  de cancelamento em plano gratuito.
- `src/pages/CreateRestaurant.jsx`: trial e texto de benefícios dinâmicos.
- `src/pages/MasterPlanos.jsx`: marcação de plano gratuito e card de configuração
  de carência/gate.
- `package.json`: inclusão do novo teste em `test:supabase`.

**Verificações executadas**

- `npx supabase migration up --local`: aplicado.
- `npx supabase db lint --local`: sem avisos para as funções novas.
- `node --test src/api/subscriptionSettings.test.js src/api/plans.test.js`:
  18 testes aprovados.
- `npm run lint`: aprovado.
- `npm run build`: aprovado.
- `npm run typecheck`: mantém os erros anteriores do projeto; a alteração nova
  em `CreateRestaurant.jsx` foi corrigida (sem `.catch` em `PromiseLike`).

O gate permanece desligado (`subscription_gate_enabled = false`) e a carência
inicial é `0`, preservando o comportamento atual até o backfill e a ativação
comercial. Nenhum valor comercial foi inventado.

**Estado do Git após a onda 1:** 81 alterações locais (24 modificados + 57 não
rastreados).
