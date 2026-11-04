# Verificação read-only — Vault e Edge secrets

## Status

**BLOQUEADO — verificação no ambiente hospedado não realizada.**

O acesso autorizado ao projeto hospedado não estava disponível neste ambiente. A verificação foi interrompida conforme a pré-condição da tarefa, sem tentativa de contorno.

## Identificação da execução

- Projeto: `dellyvery-3`
- Data/hora: `2026-11-01 20:45:37 -03:00`
- Operador: OpenCode (execução automatizada); responsável humano não informado
- Método: inspeção local read-only e verificação da disponibilidade dos meios de acesso ao hosted
- Identidade no hosted: **não confirmada**
- Organização/URL no hosted: **não verificadas**

A referência local em `PROJECT_STATE.md:212` aponta para o projeto de produção, mas não substitui a confirmação de organização, nome e URL no painel Supabase.

## Resultado por recurso

| Recurso | Classificação | Observação |
|---|---|---|
| Supabase Vault no hosted | **Não foi possível verificar** | Sem acesso autorizado ao painel ou SQL do projeto hospedado. Não classificar como “não encontrado” ou “indisponível”. |
| Edge secrets no hosted | **Não foi possível verificar** | Sem acesso ao painel ou CLI autenticada. A existência de Edge Functions não comprova suporte ou configuração de secrets. |
| Edge Functions no repositório | **Confirmadas localmente** | Existem `reseller-approve` e `reseller-invite-email-proof`; isso não valida secrets no hosted. |
| PRIV2 | **Aprovado com condição; permanece aberto** | Falta a evidência de disponibilidade exigida pela condição. |
| PRIV4 | **Condicionado; permanece aberto** | Não há procedimento de recuperação validado. |

## Evidências não sensíveis

- `supabase/config.toml:55-56`: `[db.vault]` e `secret_key` estão comentados; não há Vault configurado localmente.
- `supabase/config.toml:378-379`: Edge runtime habilitado localmente.
- `supabase/config.toml:389-390`: `[edge_runtime.secrets]` e `secret_key` estão comentados.
- `supabase/functions/reseller-approve/index.ts:3-5`: a função lê variáveis padrão de runtime via `Deno.env.get`.
- `supabase/functions/reseller-invite-email-proof/index.ts:3-12`: a função lê variáveis padrão de runtime via `Deno.env.get`.
- `docs/confirmacao-email-convites.md:51,55`: documenta que template e redirecionamento precisam ser cadastrados no painel do Supabase; não há automação.
- `docs/confirmacao-email-convites.md:53`: exige publicação da Edge Function com variáveis de runtime; é requisito, não evidência de configuração.
- `docs/etapa-3-especificacao-compra-pix-cpf.md:67`: afirma que a disponibilidade de Vault e `pgp_sym_encrypt` precisa ser validada.
- `docs/runbook-gestao-recuperacao-chaves-cpf.md:36-46`: registra verificação anterior com `supabase_vault` não encontrado e Edge secrets não confirmados; esse resultado não foi reproduzido nesta execução.
- `README.md` e `AGENTS.md`: continuam orientados a Base44; não documentam administração do Supabase hospedado.
- `package.json`: não possui scripts de deploy, secrets ou administração do Supabase.
- Não há diretório de scripts operacionais/deploy correspondente.

## Bloqueio de acesso

- CLI `supabase`: não instalada.
- Cliente `psql`: não instalado.
- Token de acesso ao hosted: ausente.
- Variáveis de URL/banco relacionadas: presentes, porém sem valores utilizáveis.
- `npx`: disponível, mas não foi usado para instalar ou baixar ferramentas.
- Painel Supabase: não há sessão autorizada acessível por este agente.
- Containers locais do Supabase em Docker: existem, mas não foram usados como evidência do ambiente hospedado.

## Limitações

- Não foi possível confirmar a identidade do projeto no hosted.
- Não foi possível verificar a disponibilidade, versão ou status do Vault.
- Não foi possível verificar a disponibilidade ou a configuração de Edge secrets.
- A configuração local não representa o projeto hospedado.
- A existência de Edge Functions não comprova suporte a Edge secrets.
- Não há evidência de recuperação de chave para PRIV4.

## Impacto sobre PRIV2 e PRIV4

- **PRIV2:** permanece condicionado. A verificação não produziu evidência suficiente para avançar para desenho técnico com base em Vault ou Edge secrets.
- **PRIV4:** permanece condicionado. Nenhum procedimento de recuperação foi observado ou validado.
- **CPF completo:** armazenamento continua adiado.
- **pgcrypto:** não deve ser escolhido por omissão ou por falta de evidência de Vault/Edge.
- A matriz de aprovação não foi atualizada.

## Critérios de saída

| Critério | Situação |
|---|---|
| Disponibilidade de Vault e Edge secrets documentada com evidência verificável | **Não atendido — bloqueado** |
| Nenhum valor sensível exposto | Atendido |
| Nenhum recurso habilitado ou modificado | Atendido |
| PRIV2 não encerrado nem convertido em autorização de implementação | Atendido |
| PRIV4 mantido condicionado | Atendido |

## Próxima ação quando houver acesso autorizado

1. Confirmar organização, nome e URL do projeto no painel Supabase.
2. Acessar **Database > Extensions** e apenas observar Vault/`supabase_vault`, versão e status.
3. Acessar **Edge Functions > Secrets** e registrar apenas disponibilidade e quantidade, sem revelar nomes ou valores.
4. Se houver SQL autorizado, executar somente `SELECT` em `pg_available_extensions` e `pg_extension`.
5. Registrar as evidências em relatório complementar, sem alterar matriz ou runbook.
6. Manter PRIV2 e PRIV4 abertos até que a evidência permita uma conclusão sustentada.

## Confirmação read-only

A verificação foi read-only. Nenhuma consulta SQL, chamada à API de secrets, operação criptográfica ou acesso ao banco hospedado foi executado. Nenhum valor de secret, token, chave ou credencial foi lido ou revelado.

Nenhum arquivo existente, banco, migration, configuração, secret ou infraestrutura foi alterado. O único artefato criado é este relatório, conforme solicitado.
