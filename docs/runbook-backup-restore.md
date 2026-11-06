# Runbook — Backup e restauração do banco (Dellyvery 3)

**Status:** preparado e com backup/restore anteriores validados; publicação bloqueada.
**Projeto Supabase:** `kmpktvcjtxwenlgzjvog` (`dellyvery-3`, região `sa-east-1`).
**Produção:** `https://kmpktvcjtxwenlgzjvog.supabase.co`.
**Commit de referência:** `43d2e20788b9699e38cc6402511b9d271b59a97c`.
**Data desta preparação:** 2026-11-04.
**Última revisão local:** 2026-11-04.

> Este documento é um procedimento. Nenhum dump, restauração, ativação de PITR,
> alteração de plano ou migration deve ser executado sem autorização explícita.
>
> O backup de 2026-11-04 e o restore isolado estão validados, mas isso **não**
> autoriza publicar: o histórico remoto precisa ser reconfirmado e um novo backup
> deve ser gerado imediatamente antes da aplicação das migrations.

## 1. Regras invioláveis

- Não restaurar sobre produção sem autorização explícita e janela de manutenção.
- Não executar `db push`, `migration repair`, `db reset` ou migrations em produção
  durante a fase de preparação.
- Não habilitar PITR, mudar plano ou contratar add-on sem autorização.
- Não gerar dump de produção sem autorização.
- Não colocar credenciais, connection strings, tokens ou chaves em arquivos,
  histórico de shell, issues, commits ou logs.
- Não considerar snapshot de frontend/repositório como backup de banco.
- Dumps devem ficar fora do repositório, criptografados e com acesso restrito.

## 2. Estado atual confirmado

### 2.1 Repositório e migrations

- Migrations locais pendentes: **24**, de `20261106000000` a
  `20261123000000_dellyvery3_gate4_hardening.sql`.
- Último estado remoto conhecido, ainda **não reconfirmado** por falta de acesso
  autorizado em 2026-11-04: **51 aplicadas**, última `20261105000000`.
- A afirmação “nenhuma migration remota sem correspondente local” só poderá ser
  mantida após `migration list --linked` e inspeção do histórico remoto.
- O runbook cobre as 24 migrations em 12 lotes; a `20261123000000` é o lote 12.
- O número de migrations aplicadas no remoto deve ser reconfirmado antes de
  qualquer lote. Não usar a contagem histórica de 51 como garantia atual.

### 2.2 Backup e restore

- Último backup validado: `F:\dellyvery-backups\prod-20261104-171753\`.
- Arquivo criptografado: `dellyvery-prod-dump.tar.gpg`, **262194 bytes**.
- SHA256 do arquivo criptografado:
  `27DC5B128CFC855031F4A626D7DC5EEB1BACBA3519E6424A406ABF1B58513E42`.
- Manifest: criado em `2026-11-04T20:31:30Z`, 51 migrations antes/depois,
  última `20261105000000`, banco com **17452179 bytes**.
- Formato: SQL plain separado (`schema.sql`, `data.sql`,
  `internal_migrations.sql`), não um snapshot custom-format único.
- Schemas incluídos: `public`, `auth`, `storage`, `supabase_migrations`.
- Excluídos: `extensions`, `graphql`, `graphql_public`, `realtime`, `vault`.
- Restore isolado: **PASS** em 2026-11-04, com duas execuções independentes;
  75 tabelas, 51 migrations, contagens e checksums de dados sem diferenças.
- Relatório autoritativo:
  `F:\dellyvery-backups\prod-20261104-171753\restore-validation-20261104_175049\RESTORE-VALIDATION-REPORT.md`.
- O `manifest.json` mantém `restore_tested_at_utc: null` e
  `restore_test_result: "pending"`; **não editar esse manifesto** para preservar
  a cadeia de evidências. O relatório separado comprova o restore e um novo
  manifesto deve ser criado para o próximo backup.
- Limitações do restore: bytes de objetos do Storage, Vault, Realtime, GraphQL,
  secrets de Edge Functions, estado externo de Pix e testes runtime de RLS não
  foram validados.
- Este backup é pontual. Qualquer escrita em produção após 2026-11-04 exige novo
  dump imediatamente antes da aplicação.

### 2.3 Estado remoto e backup automático

- Backup automático listado no último snapshot: **nenhum**
  (`backups: null`, `physical_backup_data: {}`).
- PITR: **desabilitado** no último snapshot (`pitr_enabled: false`).
- WALG: habilitado no último snapshot, mas sem base backup disponível; não
  permite restauração sozinho.
- O plano do projeto não é exposto pela CLI; confirmar no Dashboard >
  Settings > Billing.
- Acesso remoto autorizado continua indisponível; todos os itens desta seção
  precisam ser reconfirmados antes da publicação.

## 3. Opções de backup/PITR

Referências oficiais:
- https://supabase.com/docs/guides/platform/backups
- https://supabase.com/pricing

| Opção | Retenção | Requisito | Custo de referência | Observações |
|---|---:|---|---|---|
| Free — dump manual | Definida por você | CLI/`pg_dump` + armazenamento externo | Sem custo de add-on | Não inclui backup automático; exige disciplina operacional |
| Pro — backup diário | 7 dias | Plano Pro | A partir de ~US$ 25/mês | Backups diários automáticos; restauração pelo Dashboard |
| Team — backup diário | 14 dias | Plano Team | A partir de ~US$ 599/mês | Inclui recursos de equipe/SOC2 |
| Enterprise — backup diário | Até 30 dias | Plano Enterprise | Sob consulta | Retenção customizável |
| PITR (add-on) | 7, 14 ou 28 dias | Pro/Team/Enterprise + compute Small | ~US$ 100 / 200 / 400 por mês | RPO de até ~2 min; não coberto pelo Spend Cap; substitui os backups diários |

Pontos importantes:

- O PITR exige pelo menos **Small compute**; o custo total inclui plano + compute
  + add-on. Exemplo oficial: Pro + Small + PITR 7d ≈ US$ 130/mês.
- Ao habilitar PITR, a Supabase deixa de gerar backups diários; os backups passam
  a ser físicos e **não são baixáveis diretamente**.
- Backups diários/físicos **não incluem os objetos do Storage**, apenas metadados.
- Backups diários não armazenam senhas de roles customizadas; após restore pode
  ser necessário redefinir senhas.
- Para backup baixável e off-site, mantenha também dump lógico manual.

RPO de referência: dump manual = desde o último dump; backup diário = até 24 h;
PITR = até ~2 min. O RTO não deve ser prometido antes do ensaio de restauração.

## 4. Opção recomendada

### Curto prazo (sem mudança de plano)

1. Gerar um dump lógico completo e atual.
2. Calcular SHA256 e armazenar cópia criptografada fora do repositório.
3. Restaurar em ambiente isolado e validar schema, dados, migrations, RLS,
   funções, triggers e permissões.
4. Só liberar migrations depois do restore validado.

Essa é a menor barreira de segurança e não exige alteração de billing.

### Médio prazo (recomendado para produção)

1. Confirmar o plano atual no Dashboard > Settings > Billing.
2. Se o projeto for Free, avaliar upgrade para Pro para obter backup diário de 7 dias.
3. Se o orçamento permitir, habilitar PITR de 7 dias (RPO ~2 min), ciente do
   requisito de Small compute e do custo do add-on.
4. Manter dumps lógicos periódicos off-site, porque PITR não é baixável e não
   cobre objetos do Storage.

## 5. Procedimento para gerar dump lógico

### 5.1 Pré-requisitos

- Autorização explícita para gerar o dump de produção.
- Credencial de banco com permissão de leitura, obtida por canal seguro.
- `pg_dump`, `psql` e `pg_restore` versão 17.x (produção usa PostgreSQL 17.6).
- Espaço em disco local maior que o tamanho do banco (recomendado 2x).
- Diretório de destino fora do repositório, com ACL restrita.
- Ferramenta de criptografia disponível (`age`, `gpg` ou volume criptografado).
- Destino off-site com versionamento/objeto imutável, se disponível.

No ambiente atual há Docker 29.6.1 e cliente PostgreSQL 17.6 disponíveis no
container local `supabase_db_dellyvery-3`. O disco `F:` tem mais espaço livre
que `C:` e deve ser preferido para o ensaio de restauração.

### 5.2 Cuidados com credenciais

- Não passar senha em `--db-url` digitado na linha de comando.
- Preferir `PGPASSFILE` com ACL restrita ou injeção via secret manager.
- Não usar `--debug` em comandos que possam imprimir headers/URLs.
- Não usar `--dry-run` em terminal compartilhado; ele imprime o script/comando
  que seria executado e pode expor detalhes de conexão.
- Não salvar connection string em `.env` versionado.
- Limpar variáveis de ambiente e arquivos temporários ao final.

### 5.3 Comandos de referência (NÃO EXECUTAR SEM AUTORIZAÇÃO)

Os comandos abaixo são um modelo. Ajuste nomes de arquivo e caminhos. Nunca
imprima o conteúdo do dump.

```powershell
# Diretórios fora do repositório
$env:BACKUP_DIR = 'F:\dellyvery-backups\2026-11-04'
$env:RESTORE_DIR = 'F:\dellyvery-restore-test'
New-Item -ItemType Directory -Force -Path $env:BACKUP_DIR | Out-Null

# Opção A: dump plain SQL por schema (bom para inspeção e restore controlado)
supabase db dump --linked --schema public,auth,storage,supabase_migrations -f "$env:BACKUP_DIR\schema.sql"
supabase db dump --linked --data-only --schema public,auth,storage,supabase_migrations -f "$env:BACKUP_DIR\data.sql"

# Opção B: dump custom-format completo (arquivo único, bom para arquivo e pg_restore)
# Use PGPASSFILE ou secret manager; não coloque a senha na linha de comando.
pg_dump -h db.kmpktvcjtxwenlgzjvog.supabase.co -p 5432 -U postgres -d postgres \
  --format=custom --file="$env:BACKUP_DIR\full.dump"

# Integridade
Get-FileHash "$env:BACKUP_DIR\full.dump" -Algorithm SHA256 |
  Format-List > "$env:BACKUP_DIR\full.dump.sha256"
pg_restore --list "$env:BACKUP_DIR\full.dump" > "$env:BACKUP_DIR\full.dump.list.txt"

# Conferir que o dump contém o histórico de migrations e os schemas esperados
Select-String -Path "$env:BACKUP_DIR\full.dump.list.txt" -Pattern 'schema_migrations|auth|storage|public'
```

Observações:

- `supabase db dump --linked` usa o projeto linkado e uma login role temporária;
  não exige a senha do banco no terminal, mas continua exigindo autorização.
- Se o CLI não conseguir ler `auth`/`storage`, use `pg_dump` direto com a role
  `postgres` e valide se o dump inclui esses schemas.
- A conexão direta `db.<ref>.supabase.co:5432` costuma ser IPv6-only. Se não
  houver IPv6, use `supabase db dump --linked` ou o Supavisor em **session mode**;
  não use o pooler em transaction mode para `pg_dump`.
- Exija TLS (`PGSSLMODE=require` ou `sslmode=require`).
- O dump de `storage` inclui metadados, **não os bytes dos objetos**. Para os
  objetos, faça cópia separada via Storage API/S3.
- O `--data-only` do CLI omite `auth.schema_migrations` e `storage.migrations`;
  complemente com um arquivo `internal_migrations.sql` se precisar do ledger
  interno completo.
- Esquemas gerenciados `extensions`, `graphql`, `graphql_public` e `realtime`
  ficam fora do escopo. O schema `vault` não é incluído para evitar secrets.
- O dump não inclui Vault, secrets de Edge Functions, configuração de Auth
  externa, nem estado de serviços externos (Pix, e-mail, etc.).
- `schema.sql` e `data.sql` gerados separadamente **não são um único snapshot**;
  para o backup autoritativo, prefira o dump custom-format único.
- O dump contém dados sensíveis (identidades, hashes, metadados); trate-o como
  segredo e nunca o imprima no terminal.

### 5.4 Manifesto do backup

Registrar os metadados em um arquivo `manifest.json` ao lado do backup, sem
qualquer credencial:

```json
{
  "project_ref": "kmpktvcjtxwenlgzjvog",
  "environment": "production",
  "created_at_utc": "2026-11-04T00:00:00Z",
  "created_by": "operador",
  "git_commit": "43d2e20788b9699e38cc6402511b9d271b59a97c",
  "postgres_version": "17.6",
  "tool": "pg_dump 17.6",
  "format": "custom",
  "file": "full.dump.age",
  "plaintext_sha256": "<sha256-do-arquivo-antes-da-criptografia>",
  "encrypted_sha256": "<sha256-do-arquivo-criptografado>",
  "size_bytes": 0,
  "schemas": ["public", "auth", "storage", "supabase_migrations"],
  "migrations_applied": 51,
  "contains_storage_objects": false,
  "retention_days": 90,
  "restore_tested_at_utc": null,
  "restore_test_result": "pending"
}
```

Substituir os placeholders (`created_at_utc`, hashes, tamanho e `created_by`)
pelos valores reais. O manifesto deve ser armazenado junto da cópia off-site e
atualizado após o ensaio de restauração.

### 5.5 Armazenamento

- Criptografar antes de sair da máquina: `age`, `gpg` ou volume criptografado.
- Guardar o hash SHA256 junto do arquivo, em local separado.
- Retenção mínima sugerida: 30 dias; ideal 90 dias para produção.
- Preferir destino com versionamento e retenção imutável (S3-compatible).
- Restringir acesso ao backup a poucas pessoas e registrar quem acessou.
- Manter pelo menos duas cópias; testar a restauração a partir de uma cópia, não
  do único arquivo.
- Testar a descriptografia em ambiente isolado antes de considerar o backup válido.
- Nunca versionar dumps no Git.

## 6. Ambiente isolado recomendado

### Opção recomendada: stack Supabase local descartável

- Usar um **workdir separado** do repositório atual, com `project_id`, portas e
  volume próprios. Exemplo: API `55321`, DB `55325`, Studio `55323`.
- Não reutilizar o stack `supabase_db_dellyvery-3` atual, que é o banco de
  desenvolvimento em uso e contém dados locais.
- Subir com Docker e restaurar apenas nesse ambiente descartável.
- Destruir o ambiente e o volume ao final do teste.

### Alternativa: Postgres 17 descartável

- Container `postgres:17` ou `public.ecr.aws/supabase/postgres:17.6.1.166`.
- Bom para validar schema público, dados, funções, triggers e policies.
- Não reproduz Auth/Storage completos; use apenas para validação parcial.

### Alternativa: projeto Supabase de staging

- Projeto separado, nunca o de produção.
- Útil para validar Auth/Storage e fluxo completo, mas tem custo e exige
  configuração de secrets/Edge Functions fora do escopo deste runbook.

### 6.1 Comandos de restore isolado (NÃO EXECUTAR SEM AUTORIZAÇÃO)

Sempre restaurar em banco vazio e descartável, nunca em produção.

```powershell
# Variável com o banco isolado; não usar a connection string de produção
$env:RESTORE_DATABASE_URL = '<connection-string-do-ambiente-isolado>'

# Modo A: validação de schema/dados em Postgres descartável
# --no-owner/--no-privileges evita conflito de roles, mas NÃO valida ACLs.
pg_restore --clean --if-exists --no-owner --no-privileges \
  --dbname="$env:RESTORE_DATABASE_URL" "$env:BACKUP_DIR\full.dump"

# Modo B: validação de ACL/RLS no stack Supabase local
# Exige que as roles (anon, authenticated, service_role, etc.) já existam.
# Não usar --no-owner/--no-privileges neste modo.
pg_restore --clean --if-exists --role=postgres \
  --dbname="$env:RESTORE_DATABASE_URL" "$env:BACKUP_DIR\full.dump"

# Alternativa com dumps plain SQL (schema e dados separados)
psql "$env:RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$env:BACKUP_DIR\schema.sql"
psql "$env:RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -f "$env:BACKUP_DIR\data.sql"

# Pós-restore: atualizar estatísticas e validar conexão
psql "$env:RESTORE_DATABASE_URL" -c "analyze;"
psql "$env:RESTORE_DATABASE_URL" -c "select current_database(), version();"
```

- Se o restore falhar por role/owner, registrar o erro e repetir no Modo A;
  não “corrigir” permissões em produção para acomodar o restore.
- Em caso de erro de extensão, garantir que as extensões necessárias estejam
  disponíveis no ambiente de destino antes de repetir.

## 7. Critérios de validação da restauração

### 7.1 Arquivo

- Tamanho maior que zero e compatível com o esperado.
- SHA256 confere com o manifesto.
- `pg_restore --list` retorna exit 0 (custom-format).
- Descriptografia funciona e o hash do conteúdo descriptografado confere.
- `schema.sql` e `data.sql` não contêm erros de sintaxe/encoding.

### 7.2 Schema

Comparar antes/depois no ambiente isolado:

```sql
select schemaname, count(*) as tabelas
from pg_tables
where schemaname in ('public', 'auth', 'storage')
group by schemaname order by schemaname;

select n.nspname, count(*) as funcoes
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'auth', 'storage')
group by n.nspname order by n.nspname;

select count(*) as triggers_nao_internos
from pg_trigger where not tgisinternal;

select schemaname, count(*) as policies
from pg_policies where schemaname in ('public', 'auth', 'storage')
group by schemaname order by schemaname;
```

- Verificar tabelas, colunas, tipos, defaults, constraints, índices, views,
  sequences, funções, triggers e policies esperadas.
- Verificar `SECURITY DEFINER` e `search_path` das funções críticas.
- Verificar grants de `anon`, `authenticated` e `service_role`.

### 7.3 Dados

- Contagens por tabela crítica, sem imprimir linhas.
- Checksums agregados para tabelas pequenas/médias; para tabelas grandes, usar
  contagem + min/max de timestamps + amostragem.
- Tabelas críticas mínimas: `companies`, `profiles`, `company_members`, `plans`,
  `subscriptions`, `orders`, `order_items`, `products`, `customers`,
  `reseller_*`, `platform_settings`, `plan_purchase_*` (quando existirem).
- Comparar deltas esperados; qualquer diferença não explicada bloqueia o restore.

### 7.4 Histórico de migrations

```sql
select count(*) as total, max(version) as ultima
from supabase_migrations.schema_migrations;
```

- Antes das migrations: esperado **51** no snapshot de 2026-11-04; reconfirmar
  o valor real no remoto antes de publicar.
- Depois das 24 migrations: esperado **75**.
- Se o dump não contiver `supabase_migrations`, o backup é considerado incompleto
  para fins de rollback.
- Se o remoto já tiver recebido qualquer migration após `20261105000000`, usar a
  contagem remota real como baseline e não a contagem histórica deste runbook.

### 7.5 Funções, triggers e RLS

- Executar os testes SQL existentes em `supabase/tests/` no ambiente isolado,
  com fixtures, e comparar resultados esperados.
- Testar cenários negativos:
  - usuário sem vínculo não lê/escreve empresa alheia;
  - cliente de revenda sem convite aceito não ativa;
  - empresa sem acesso ativo não cria pedido nem expõe storefront;
  - `anon` não executa funções internas;
  - `service_role` mantém os acessos operacionais esperados.
- Verificar se o event trigger `dellyvery3_revoke_new_function_acl` está presente
  e habilitado (`pg_event_trigger.evtenabled = 'O'`) após `20261115000000` e
  novamente após `20261123000000`. A `20261123000000` só cria o trigger se ele
  estiver ausente; não habilita um trigger preexistente desabilitado.
- Se o trigger estiver ausente ou desabilitado e o runner não puder corrigir,
  tratar como pendência bloqueadora e instalar/habilitar como `supabase_admin`
  antes de liberar o lote seguinte.

### 7.6 Auth e Storage

- `auth.users`, `auth.identities`: contagens; nunca imprimir hashes/senhas.
- `storage.buckets`, `storage.objects`: contagens e metadados.
- Confirmar se o dump inclui `auth`/`storage`; se não incluir, declarar a
  limitação e testar Auth/Storage separadamente.
- Objetos do Storage não vêm no dump do banco; validar cópia separada dos bytes.

### 7.7 Fluxos essenciais

Executar em ambiente isolado, com dados de teste:

1. Login e sessão.
2. Dashboard e seleção de empresa.
3. Cardápio público e criação de pedido.
4. Mudança de status do pedido.
5. Ativação/renovação de cliente de revenda.
6. Compra/cancelamento/confirmação de créditos de revenda.
7. Compra de plano via Pix: criar, enviar comprovante, confirmar, rejeitar,
   cancelar e expirar.
8. Upload/leitura do QR Pix e políticas do bucket.
9. Testes negativos de RLS.

## 8. Restauração de produção (somente com autorização)

- A restauração de produção deve ser feita pelo mecanismo oficial da Supabase
  (Dashboard/PITR), não por `pg_restore` direto no banco de produção.
- Antes: declarar incidente, congelar escritas quando possível, registrar
  horário/estado atual, identificar o último ponto bom e validar em isolado.
- Durante: o projeto fica indisponível; downtime depende do tamanho do banco.
- Após: reautenticar, recriar replication slots/subscriptions necessários,
  redefinir senhas de roles customizadas se aplicável, reconciliar pagamentos
  Pix/ledger de créditos e validar RLS/fluxos essenciais.
- Comunicar RPO/RTO reais após medir o ensaio.

## 9. Lotes recomendados para as 24 migrations

Sequência para cada lote: restaurar o dump no ambiente isolado → aplicar o lote
no isolado → executar validações/testes → gerar backup de produção validado →
aplicar o mesmo lote em produção → validar. Um lote por vez, em janela de
manutenção, com critérios de parada. As migrations de maior risco devem ser
aplicadas isoladamente.

| Lote | Migrations | Pré-checks principais | Pós-checks principais |
|---|---|---|---|
| 0 — Baseline | nenhuma | `migration list --linked`; contagens; políticas; funções; smoke test; backup validado | Registrar baseline e hash; confirmar restore aprovado |
| 1 — Revenda base | `20261106000000`, `20261107000000`, `20261108000000`, `20261109000000` | Duplicidades em `reseller_clients`; dados do ledger; `platform_settings`; constraints | Tabelas/RLS/RPCs; constraints; grants; ledger |
| 2 — Cliente de revenda | `20261109000001`, `20261109000002`, `20261109000003`, `20261109000004` | Duplicidades `user_id`/`company_id`; assinaturas/empresas; pedidos; storefront | Convite/claim/ativação; RLS; criação de pedido; storefront |
| 3 — Segurança da revenda | `20261110000000`, `20261111000000`, `20261112000000` | Assinaturas de funções; owners; triggers; grants de `service_role` | Guard trigger; ativação/cancelamento; schema privado inacessível |
| 4 — ACL/search_path | `20261113000000`, `20261114000000`, `20261114000001` | `current_user` `postgres`/`supabase_admin`; extensions; allowlist; ownership | `has_function_privilege`; `anon`/`PUBLIC` negados; API smoke |
| 5 — SECURITY DEFINER | `20261115000000` (isolada) | Inventário de funções; event trigger ausente; privilégios DML baseline | Event trigger habilitado; grants preservados; API smoke; DML intacto |
| 6 — ACL público | `20261116000000` (isolada) | Privilégios MAINTAIN/TRUNCATE/REFERENCES/TRIGGER; ownership; versão 17+ | Grants restritos; `service_role` preservado; API smoke |
| 7 — Estado de assinatura + helper | `20261117000000`, `20261117000001` | `plans`, `subscriptions`, `platform_settings`; gate default; `is_platform_admin` | Backfill `canceled_at`; gate off; grace grants; helper STABLE; testes de assinatura |
| 8 — Créditos de revenda | `20261118000000` (isolada) | Pedidos pendentes duplicados; pedidos creditados consistentes; `platform_settings` | Criar/cancelar/confirmar/rejeitar crédito; expiração; constraint de duplicidade |
| 9 — Bloqueio de upgrade pago | `20261119000000` (isolada) | `plans.is_free`; `manage_subscription`; assinaturas de revenda | Upgrade pago bloqueado; cancel/reactivate/gratuito funcionando |
| 10 — Compra de plano Pix | `20261120000000` (isolada) | `platform_settings`; nenhuma solicitação pendente; PIX config; storage | Criar/enviar/confirmar/rejeitar/cancelar/expirar; idempotência; ledger |
| 11 — QR/storage + exibição | `20261121000000`, `20261122000000` | Bucket `platform-assets`; policies; QR; funções | Upload/leitura do QR; escrita só admin; exibição para revenda |
| 12 — Gate 4 / referências Pix | `20261123000000` (isolada) | Runner `postgres`/`supabase_admin`; dependências `plan_purchase_requests`, `reseller_credit_orders`, `platform_pix_settings`; duplicidades de `payment_reference` na mesma tabela e entre tabelas; `proof_url` inválida; estado do event trigger; backup novo validado | Índices únicos normalizados; registry `payment_reference_claims` populado; triggers de claim; FKs `rejected_by` em `RESTRICT`; expiração escopada; `proof_url` CHECK; `patch_platform_pix_settings`; wrapper; event trigger presente e habilitado; testes G1–G10 |

Regras adicionais:

- A ordem dos lotes é a ordem canônica. Não executar migrations fora de ordem,
  não pular lotes e não reaplicar uma migration já registrada no remoto.
- `20261113000000` exige runner transacional. Se o runner não for transacional,
  não aplicar em lote e tratar como migration isolada.
- **Não reaplicar a allowlist de ACL `20261113000000`** depois de
  `20261118000000`, `20261119000000` ou `20261120000000`. A migration falha de
  propósito para evitar reexecução sobre o estado financeiro já evoluído.
- `20261115000000` e `20261116000000` são as de maior risco de ACL; aplicar em
  lotes dedicados, uma de cada vez, e monitorar erros 401/403/500.
- `20261115000000` exige privilégio para `CREATE EVENT TRIGGER`. Se o runner não
  for superuser/owner, a migration registra `PENDENTE`; nesse caso, instalar o
  event trigger como `supabase_admin` e comprovar que ele está **presente e
  habilitado** antes de seguir.
- `20261116000000` exige PostgreSQL 17+ e ownership/membership sobre as tabelas
  públicas. Se `supabase_admin` não puder ser alterado pelo runner, registrar a
  pendência e executar o `ALTER DEFAULT PRIVILEGES` como `supabase_admin` antes
  de considerar o lote concluído.
- `20261123000000` deve rodar depois do lote 11 e de forma isolada. Ela depende
  de `20261118000000`, `20261120000000` e `20261121000000`. O runner deve ser
  `postgres` ou `supabase_admin`; a migration não abre `BEGIN/COMMIT` e deve ser
  executada em transação pelo runner.
- `20261123000000` não habilita event trigger preexistente que esteja
  desabilitado. Verificar `pg_event_trigger.evtenabled = 'O'`; se estiver
  diferente, habilitar manualmente como `supabase_admin` e registrar a ação.
- Antes do lote 12, verificar duplicidades normalizadas de `payment_reference`
  nas duas tabelas e duplicidades confirmadas entre elas. O preflight da
  migration falha se houver conflito; não “corrigir” dados sem decisão humana e
  sem backup validado.
- `20261118000000`, `20261119000000`, `20261120000000` e `20261123000000` são
  financeiras/de entitlement; aplicar em lotes dedicados e validar
  ledger/idempotência antes do próximo lote.
- Parar imediatamente se: migration falhar, contagem divergir sem explicação,
  RLS negativa falhar, API apresentar aumento de erros, event trigger não estiver
  habilitado ou backup não estiver validado.

### 9.1 Decisões humanas que bloqueiam a publicação

Estas decisões não impedem a preparação local, mas devem estar resolvidas antes
de aplicar o lote correspondente e publicar. Detalhes e alternativas estão em
`docs/etapa-3-decisoes-pendentes.md`.

1. **Reutilização de `payment_reference`:** decidir se uma referência confirmada
   pode ser liberada após rejeição, cancelamento ou estorno, e qual o processo
   manual/auditado. O registry atual mantém a referência confirmada.
2. **Comprovante:** decidir se `proof_url` é obrigatório e qual o prazo de
   expiração da solicitação pendente.
3. **Cancelamento/estorno:** definir a política financeira e o reflexo no
   ledger, na assinatura e nas referências Pix.
4. **`rejected_by`:** decidir se profiles com histórico de rejeição serão
   retidos ou anonimizados; a FK está em `ON DELETE RESTRICT`.
5. **Pix parcial:** confirmar o contrato de UI/integrações para
   `set_platform_pix_settings` preservar campos omitidos e
   `patch_platform_pix_settings` permitir limpar campos com `null`.
6. **`manage_subscription`:** decidir se algum backend precisa de execução por
   `service_role`; hoje o grant é apenas para `authenticated`.
7. **Carência:** definir cobertura para estados `pendente`/`suspenso` e o teto
   comercial.
8. **Plano gratuito:** decidir se plano gratuito ignora `expires_at`.
9. **CORS de `reseller-approve`:** definir a política de `APP_ORIGIN` antes de
   publicar a Edge Function.
10. **Event trigger:** decidir se será instalado manualmente como
    `supabase_admin` quando o runner não tiver privilégio, ou se o default ACL
    será suficiente.

## 10. Limitações conhecidas do rollback

- Não há migrations de rollback; o rollback é baseado em restore.
- Restaurar um backup descarta todos os dados posteriores ao ponto escolhido.
- Backups diários/físicos não incluem objetos do Storage.
- Backups diários não incluem senhas de roles customizadas.
- `pg_dump` não cria roles; o cluster de destino precisa ter as roles antes do
  restore. Restaurar com `--no-owner --no-privileges` não valida ACLs reais.
- `schema.sql` + `data.sql` separados não formam um snapshot único; para
  consistência, use o dump custom-format.
- PITR substitui backups diários e não é baixável diretamente.
- Vault, secrets, Edge Functions e configuração externa não são cobertos pelo
  dump do banco.
- Pagamentos Pix e estados externos podem ficar inconsistentes com o banco
  restaurado; exigem reconciliação manual.
- Event trigger/default privileges/ACL podem permanecer aplicados se o rollback
  for feito por SQL inverso em vez de restore completo.
- O RTO real só pode ser declarado após um ensaio de restauração com o tamanho
  atual do banco.

## 11. Autorizações necessárias antes de executar

1. Recuperar o acesso remoto autorizado ao Supabase e à VPS, com token/credencial
   obtidos por canal seguro, sem registrar segredos no repositório.
2. Autorização para inspecionar o remoto em modo read-only: projeto correto,
   `migration list --linked`, contagens, funções, policies, Edge Functions,
   Auth/URLs, secrets, Vault, Storage e bucket `platform-assets`.
3. Autorização para gerar um dump novo de produção.
4. Autorização para criar ambiente isolado de restauração e executar o restore
   de validação.
5. Autorização para habilitar PITR/backup automático e eventual mudança de plano.
6. Autorização para iniciar os lotes de migrations em produção, um por vez.
7. Autorização separada para publicar Edge Functions e fazer commit/push/deploy.

Sem essas autorizações, o processo permanece apenas neste documento. A
autorização de preparação local não implica autorização para nenhuma das etapas
acima.
