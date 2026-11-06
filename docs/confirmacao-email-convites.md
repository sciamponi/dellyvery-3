# Confirmação de e-mail nos convites de revenda

## Regra de segurança

O aceite do convite só conclui o vínculo entre cliente e revendedor depois que o backend registra uma prova de posse do e-mail convidado. A prova não usa `email_confirmed_at`, `amr` do JWT nem OTP de telefone como autorização: ela é criada por uma Edge Function depois de validar um código de e-mail de 8 dígitos no Supabase Auth.

A RPC `claim_reseller_client_invite` exige, na mesma transação:

- convite `pending` e não expirado;
- usuário autenticado com `email_confirmed_at` preenchido;
- prova em `reseller_invite_email_proofs` com o mesmo `invite_id`, o mesmo `user_id`, o mesmo e-mail normalizado, `method = 'email_otp'`, não consumida e dentro do TTL;
- consumo da prova junto com o vínculo `reseller_clients.user_id`, o status `accepted` e o `audit_logs`.

A prova é de uso único e expira em 15 minutos. O código enviado pelo Supabase Auth expira em 1 hora; reenviar o código não cria prova nem aceite.

## Fluxo

1. O cliente autenticado abre `/convite-cliente/:token`.
2. O frontend chama a Edge Function `reseller-invite-email-proof` com `action = "request"`.
3. A função resolve o convite, confere que o e-mail da sessão é o e-mail convidado e envia o código via `signInWithOtp` com `shouldCreateUser: false`.
4. O cliente informa o código de 8 dígitos.
5. A função chama `verifyOtp({ email, token, type: "email" })`, confirma que o usuário retornado é o mesmo da sessão e grava a prova pela RPC `record_reseller_invite_email_proof`.
6. O frontend chama `claim_reseller_client_invite`, que consome a prova e cria o vínculo.

Se o e-mail da conta mudar depois da prova, o `claim` falha. Se o convite expirar, ele é marcado como `expired` e não pode mais ser aceito.

## Comportamento com `Confirm email` habilitado

- `signUp` pode retornar usuário sem sessão e enviar o link de confirmação para `/convite-cliente/:token`.
- Depois de confirmar o cadastro, o cliente entra e confirma o convite pelo código de 8 dígitos.
- O código é independente do link de confirmação do cadastro e não é substituído por ele.

## Comportamento com `Confirm email` desabilitado

- `signUp` retorna sessão imediatamente.
- Com convite, o frontend navega direto para `/convite-cliente/:token` sem encerrar a sessão e sem enviar magic link.
- O aceite continua bloqueado até o código de e-mail ser verificado pela Edge Function.
- Contas existentes também precisam passar pelo código antes de aceitar.

## Tabela e RPCs

- `public.reseller_invite_email_proofs`: `invite_id`, `user_id`, `email`, `method`, `verified_at`, `expires_at`, `consumed_at`, `created_by`; unicidade por `(invite_id, user_id)`.
- RLS habilitada; `public`, `anon` e `authenticated` não leem nem escrevem diretamente. `service_role` tem somente `select` para auditoria/testes.
- `record_reseller_invite_email_proof(p_invite_id, p_user_id, p_email, p_ttl_seconds)`: `security definer`, executável apenas por `service_role`.
- `resolve_reseller_client_invite`: volta a marcar convite vencido como `expired` de forma persistente.
- `claim_reseller_client_invite`: valida e consome a prova com `for update`, sem depender de OTP genérico ou telefone.

## Dependências externas

- Entrega de e-mail do Supabase Auth: SMTP do projeto hospedado ou Mailpit local em `http://127.0.0.1:54324`.
- Template de e-mail com `{{ .Token }}` (código de 8 dígitos). O template local fica em `supabase/templates/magic_link.html` e está registrado em `supabase/config.toml`; o projeto hospedado precisa do template equivalente cadastrado no painel do Supabase.
- O template local contém `{{ .Token }}` e `{{ .ConfirmationURL }}`; o fluxo valida somente o código. A coexistência dos dois precisa ser coberta pelo teste de integração para evitar consumo do token pelo link.
- URL de redirecionamento para `/convite-cliente/**` nos domínios da aplicação.
- Edge Function publicada com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` (ou `SUPABASE_PUBLISHABLE_KEY`) e `APP_ORIGIN`.

A configuração local permite `http://localhost:5173/convite-cliente/**` e `http://localhost:5174/convite-cliente/**`. Em produção, a mesma cobertura deve ser cadastrada no painel do Supabase; nenhuma alteração remota é feita pelo código.

Sem entrega de e-mail, template com código ou redirecionamento permitido, o fluxo falha fechado: o convite permanece pendente e não há aceite por e-mail apenas declarado.

## Testes

- `supabase/tests/rls_reseller_client_access.sql`: 25 casos de RLS/RPC, incluindo prova ausente, usuário/e-mail errados, prova expirada, prova válida de uso único, convite expirado persistente e tabela inacessível ao cliente.
- `supabase/tests/invite_email_proof.integration.mjs`: teste real com JWT de signup, OTP entregue no Mailpit, gravação da prova, replay, troca de e-mail, aceite e bloqueio de acesso direto à tabela.
- `npm run test:supabase`: suíte unitária do frontend.
- `npm run test:invite-proof`: teste de integração acima, com Supabase local e Edge Function servida.
- `npm run lint` e `npm run build` antes de publicar.
