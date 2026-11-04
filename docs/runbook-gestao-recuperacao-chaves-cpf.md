# Runbook — gestão e recuperação de chaves de CPF

> **Status:** PROPOSTA DE RUNBOOK. NÃO APROVADO. Nenhuma implementação realizada.
> **Data:** 2026-11-01.
> **Repositório:** `dellyvery-3` — branch `feat/supabase-foundation`, commit de
> referência `3f1e026`.
> **Fonte:** proposta de runbook fornecida nesta conversa e contexto da
> verificação read-only do projeto Supabase hospedado.
> **Regra:** este documento não altera
> `docs/etapa-3-aprovacoes-compra-pix-cpf.md`, código, migrations, banco,
> configurações, secrets, testes ou infraestrutura. Não cria, revela, gera ou
> rotaciona chaves. Não declara PRIV2 ou PRIV4 encerrados.

## Legenda

- `[OBSERVADO]` — fato registrado no contexto ou na verificação read-only.
- `[PROPOSTA]` — desenho recomendado, ainda não implementado ou aprovado.
- `[RISCO]` — risco identificado que precisa de tratamento ou aceite formal.
- `[PENDENTE]` — decisão ainda não aprovada.

## Objetivo e escopo

Este documento formaliza uma **proposta** de runbook para gestão, custódia,
rotação, backup e recuperação das chaves usadas na proteção de CPF.

O escopo é exclusivamente documental. Não há implementação de armazenamento de
CPF, não há execução de criptografia ou descriptografia no banco hospedado e não
há criação ou manuseio de chaves reais.

`[OBSERVADO]` O armazenamento de CPF completo permanece adiado. Este runbook
prepara as condições para uma decisão futura, sem antecipar aprovação de PRIV2 ou
PRIV4.

## Estado atual conhecido

`[OBSERVADO]` A verificação read-only do projeto Supabase hospedado identificou:

- `pgcrypto` habilitada.
- Funções disponíveis no schema `extensions`: `digest`, `gen_random_bytes`,
  `hmac`, `pgp_sym_encrypt` e `pgp_sym_decrypt`.
- `pgsodium` inativa.
- `supabase_vault` não encontrado; portanto, Vault **não está confirmado** como
  disponível.
- Não havia procedimento aprovado de recuperação de chaves; este documento é uma
  proposta.
- A disponibilidade de Edge Function secrets no ambiente hospedado não foi
  confirmada.
- PRIV2 e PRIV4 continuam condicionados.
- O armazenamento de CPF completo permanece adiado.

`[OBSERVADO]` `pgcrypto` disponibiliza primitivas criptográficas, mas não resolve
sozinho a custódia, o controle de acesso, o backup ou a recuperação das chaves.

`[OBSERVADO]` Nenhum teste de recuperação, criptografia ou descriptografia foi
executado no banco hospedado. Nenhum dado real de cliente foi acessado.

`[PROPOSTA]` Não depender de Vault sem validação específica. Também não presumir
que Edge secrets estarão disponíveis ou que o backup do banco inclui a chave.

## Opções de custódia de chaves

`[PROPOSTA]` A escolha da custódia deve manter a chave fora do banco, do
frontend, do repositório e de `platform_settings`. As opções abaixo são
alternativas de desenho; nenhuma está aprovada.

`[PENDENTE]` A preferência registrada na matriz é Vault/Edge. KMS/HSM é
alternativa fora dessa preferência e não altera a ordem sem decisão explícita e
atualização da matriz; `pgcrypto` segue a condição da matriz, com aceitação
explícita de risco.

### Opção A — KMS/HSM externo com envelope encryption

`[PENDENTE]` KMS/HSM é alternativa proposta, ainda não aprovada e fora da
preferência registrada na matriz; disponibilidade, egress e política de acesso
não foram confirmados. A regra vigente permanece: Vault/Edge primeiro; se
indisponíveis, adiar o armazenamento de CPF completo; `pgcrypto` somente com
aceitação explícita de risco.

`[PROPOSTA]` A chave mestra (KEK) fica em um KMS/HSM externo, fora do Supabase e
nunca entra no banco. Uma chave de dados (DEK) é gerada ou desembrulhada pelo
KMS e usada pelo componente autorizado. O banco guarda apenas ciphertext, versão
da chave e, se necessário, a DEK embrulhada; a DEK embrulhada é ciphertext e não
a chave em texto claro.

`[PROPOSTA]` Esta opção reduz a exposição da chave ao banco, mas introduz
dependência de um provedor externo, latência e necessidade de confirmar egress e
política de acesso. Não é a preferência registrada na matriz.

`[PENDENTE]` Escolher provedor, modelo de custódia, política de acesso e
procedimento de recuperação do KMS/HSM.

### Opção B — Edge Function secret

`[PROPOSTA]` A chave fica em um secret de Edge Function; não é persistida no
banco da aplicação nem no frontend, mas permanece no cofre de secrets do
provedor. A criptografia e a descriptografia ocorrem na função.

`[PENDENTE]` Confirmar se o ambiente hospedado aceita secrets de Edge, se eles
são protegidos adequadamente, se podem ser rotacionados e se há procedimento de
recuperação.

`[RISCO]` Secrets de Edge ainda não confirmados; usá-los sem validação cria
dependência não comprovada.

### Opção C — `pgcrypto` no banco como fallback

`[PROPOSTA]` Usar `pgcrypto` apenas como primitiva de criptografia, com a chave
injetada em runtime e nunca persistida no banco. A chave não deve ser armazenada
em tabela, migration, seed ou `platform_settings`.

`[RISCO]` Mesmo sem persistência, a chave transita até o banco e pode aparecer
em logs, statement logs, ferramentas de observabilidade ou mensagens de erro.
Esta opção exige decisão explícita de risco, redaction de logs e controles
adicionais.

`[PENDENTE]` Se `pgcrypto` será aceito como fallback e sob quais condições.

### Regras comuns às opções

`[PROPOSTA]` A chave nunca deve ficar no frontend, no repositório, em migrations,
seeds, `localStorage`, `sessionStorage`, `platform_settings`, `company_settings`
ou backups do banco.

`[PROPOSTA]` Metadados não secretos podem ser armazenados no banco: versão da
chave, algoritmo, data de criação, status e versão do pepper HMAC. A chave em si
não pode.

`[PENDENTE]` Algoritmo, tamanho de chave e parâmetros criptográficos não estão
definidos; não presumir valores.

## Separação entre chave de criptografia e chave HMAC

`[PROPOSTA]` Separar a chave de criptografia do pepper usado para HMAC-SHA256. A
criptografia protege a confidencialidade; o HMAC permite busca ou
deduplicação sem expor o CPF. Não usar a mesma chave para os dois fins.

`[PROPOSTA]` Cada registro deve permitir identificar a versão usada:

- `cpf_key_version` — versão da chave de criptografia.
- `cpf_alg` — algoritmo ou parâmetros de criptografia.
- `cpf_hmac_version` — versão do pepper HMAC.
- ciphertext — resultado da criptografia.
- HMAC — resultado do HMAC-SHA256 com o pepper correspondente.

`[PROPOSTA]` O envelope do ciphertext deve permitir identificar a versão e o
algoritmo sem depender de uma configuração global mutável. A versão é metadado
não secreto; a chave e o pepper não são.

`[PROPOSTA]` Não usar criptografia determinística para o CPF. Para busca, usar o
HMAC versionado. Não usar o CPF como chave, pepper ou segredo.

`[PROPOSTA]` Logs, auditoria, erros e exports devem registrar apenas metadados:
ator, data, operação, `record_id`, versão da chave, finalidade e resultado.
Nunca CPF, plaintext, chave, pepper ou ciphertext.

`[RISCO]` Logs de SQL, Edge Functions, APM, Sentry, exports e mensagens de erro
podem capturar payloads ou parâmetros. A redaction precisa ser verificada antes
de qualquer uso real.

## Papéis, permissões e auditoria

`[PROPOSTA]` Papéis mínimos:

- **Owner da política:** Master (`PLATFORM_ADMIN`), responsável por aprovar a
  política e responder pela custódia.
- **Custodiante operacional:** pessoa ou equipe designada para guardar e
  recuperar a chave, com controle dual quando possível.
- **Aprovador:** segundo autorizador para operações críticas, como rotação,
  exportação e break-glass. Por padrão, outro Master. Aprovação por não-Master é
  `[PENDENTE]` e exige decisão futura explícita e atualização da matriz.
- **Sem acesso:** frontend, usuários de empresa, OWNER/ADMIN, revendedores,
  suporte comum e desenvolvedores sem autorização formal.

`[PROPOSTA]` Aplicar menor privilégio: acesso à chave somente por função ou
serviço autorizado, com política restrita no KMS/secret manager.

`[PROPOSTA]` Não manter acesso permanente. O acesso deve ser just-in-time, com
escopo, finalidade e janela de tempo.

`[PROPOSTA]` Acesso excepcional exige ticket, justificativa, aprovador, horário,
duração e resultado. Revisar acessos periodicamente e revogar imediatamente
quando o papel mudar.

`[PENDENTE]` Definir owner, custodiante, aprovador e substituto do Master para
break-glass.

`[RISCO]` Se apenas uma pessoa detiver a chave ou a aprovação, há risco de perda
de acesso, erro operacional ou ausência de segregação de funções.

## Rotação e versionamento

`[PROPOSTA]` Procedimento de rotação:

1. Gerar uma nova versão no KMS/secret manager, sem sobrescrever a anterior.
2. Publicar a nova versão no componente autorizado; novas gravações passam a
   usar a nova versão.
3. Manter leitura compatível com versões anteriores, descriptografando cada
   registro conforme `cpf_key_version`.
4. Recriptografar em lotes, com job idempotente, checkpoint, limite de taxa e
   monitoramento. Ler com a versão antiga, gravar com a nova e atualizar a
   versão; nunca logar plaintext.
5. Recalcular o HMAC ao rotacionar o pepper. O HMAC antigo não pode ser
   recalculado sem o CPF; por isso, a transição precisa de uma estratégia
   explícita, ainda não aprovada. Alternativas propostas: dual-write/dual-read,
   HMACs versionados ou backfill controlado. Validar a busca antes de aposentar
   o pepper antigo.
6. Validar contagem de registros, ausência de erros de decrypt, amostragem
   sintética e integridade dos HMACs.
7. Aposentar a chave antiga: remover do uso ativo, revogar acessos e manter
   cópia de recuperação pelo prazo definido.
8. Destruir a chave antiga somente após confirmar que nenhum registro depende
   dela e após validação jurídica de retenção.
9. Em caso de comprometimento, executar rotação emergencial, revogar a versão
   afetada, recriptografar e abrir incidente.

`[PENDENTE]` Definir periodicidade de rotação, janela de retenção da chave
antiga e estratégia de rotação do pepper HMAC. Escolher entre dual-write/dual-read,
HMACs versionados ou backfill controlado; nenhuma alternativa está aprovada.

`[RISCO]` Destruir a chave antiga antes da recriptografia completa pode causar
perda irreversível. Rotacionar o pepper sem estratégia de recálculo pode quebrar
buscas e deduplicação.

## Backup e recuperação

`[PROPOSTA]` O backup da chave deve ser separado do backup do banco, em domínio
de confiança distinto, criptografado e com controle de acesso próprio.

`[PROPOSTA]` Não presumir que o backup do Postgres/Supabase inclui a chave. O
backup do banco pode conter ciphertext, mas não necessariamente a chave de
descriptografia.

`[PROPOSTA]` Nenhum backup, export ou cópia de segurança pode conter CPF em
texto puro. A chave deve permanecer separada do backup do banco.

`[PROPOSTA]` Manter pelo menos duas cópias independentes, com integridade
verificável, uma preferencialmente offline ou imutável. O acesso ao backup exige
duplo controle, justificativa e registro.

`[PROPOSTA]` Procedimento de recuperação:

1. Declarar incidente e obter autorização.
2. Identificar a versão ou versões necessárias.
3. Recuperar a chave do backup/KMS em ambiente isolado.
4. Validar com ciphertext sintético, nunca com CPF real.
5. Promover para o ambiente controlado e monitorar falhas de decrypt.
6. Registrar auditoria, revisar acessos e comunicar conforme validação
   jurídica.

`[PROPOSTA]` Como comprovar ausência de texto puro: revisão de schema e código;
teste sintético de round-trip; busca por CPF sintético em logs e exports;
verificação de que a coluna é ciphertext; revisão de backups com dados
sintéticos. Não inspecionar CPF real.

`[PROPOSTA]` Como evitar perda irreversível: versionamento, múltiplas cópias,
teste periódico de recuperação, monitoramento de falhas de decrypt, proibição de
destruir a última chave válida e documentação de RPO/RTO.

`[RISCO]` Backup do banco sem a chave, cópia única, ausência de teste de
restauração ou destruição prematura podem tornar os dados irrecuperáveis.

## Procedimento de break-glass

`[PROPOSTA]` Execução restrita ao Master (`PLATFORM_ADMIN`). Solicitação somente
por esse papel.

`[PROPOSTA]` Aprovação por segundo aprovador. Por padrão, outro Master. Se houver
apenas um Master, definir antecipadamente um aprovador alternativo. Aprovação por
não-Master é `[PENDENTE]` e exige decisão futura explícita e atualização da
matriz.

`[PROPOSTA]` Justificativa obrigatória: incidente, finalidade, escopo, versão da
chave, janela de tempo e registros afetados.

`[PROPOSTA]` Auditoria obrigatória: ator, aprovador, horário, operação, versão,
`record_id` sem CPF, resultado e revogação. O log deve ser imutável e revisável.

`[PROPOSTA]` Revisão posterior: revisar o acesso logo após o uso, confirmar
necessidade, registrar conclusão e abrir incidente se houver exposição.

`[PROPOSTA]` Revogação: remover permissões temporárias, invalidar sessões ou
tokens, rotacionar a chave se houver suspeita de comprometimento e confirmar que
o acesso não permanece ativo.

`[PENDENTE]` Definir quem pode solicitar, quem pode autorizar e qual o aprovador
alternativo quando não houver segundo Master disponível. Aprovação por não-Master
exige decisão futura explícita e atualização da matriz.

## Testes de recuperação em ambiente não produtivo

`[PROPOSTA]` Executar em ambiente não produtivo, isolado, com dados
exclusivamente sintéticos.

`[PROPOSTA]` Cenários mínimos:

- decrypt normal com a versão atual;
- leitura de registro com versão antiga;
- falha controlada com versão errada;
- rotação e recriptografia em lote;
- recuperação da chave conforme a custódia: restauração de escrow para chave
  exportável; recuperação ou rotação gerenciada para KMS/HSM;
- tentativa de acesso não autorizado;
- verificação de ausência de plaintext em logs.

`[PROPOSTA]` Critérios de sucesso: decrypt correto, versão antiga legível,
rotação sem perda, recuperação da chave concluída conforme a custódia escolhida,
auditoria completa, nenhum plaintext em log ou export e RTO/RPO dentro do
definido.

`[PROPOSTA]` Critérios de falha: chave indisponível, decrypt impossível, registro
perdido, plaintext exposto, auditoria incompleta ou recuperação da chave não
comprovada.

`[PROPOSTA]` Evidências permitidas: data, ambiente, versões de chave, IDs
sintéticos, resultados booleanos, trilha de auditoria, capturas redigidas e
sign-off. Não registrar chave, CPF ou ciphertext.

`[OBSERVADO]` Nenhum teste de recuperação foi executado até o momento.

## Incidentes, retenção e descarte

`[PROPOSTA]` Chave perdida: interromper operações afetadas, avaliar impacto,
tentar recuperação pelo backup, registrar incidente e comunicar conforme
validação jurídica. Se irrecuperável, registrar formalmente a perda de dados.

`[PROPOSTA]` Sem recuperação, assumir que o CPF completo pode não voltar a ser
exibível. A recriptografia deve ser planejada antes da perda da chave.

`[PROPOSTA]` Chave comprometida: rotação emergencial, revogação imediata,
recriptografia, revisão de acessos, análise de exposição e incidente formal.

`[PROPOSTA]` Após qualquer incidente ou break-glass, revisar quem acessou, por
quê, por quanto tempo e se a permissão foi removida.

`[PROPOSTA]` Retenção e descarte condicionados à validação jurídica. Não inventar
prazos legais. Definir base legal, prazo, responsável, forma de destruição
segura e certificado de descarte.

`[PROPOSTA]` Resposta a incidente: detectar, conter, avaliar, erradicar,
recuperar e revisar. Notificação externa somente após validação jurídica.

`[PENDENTE]` Validar juridicamente retenção, descarte e critérios de notificação
de incidente.

## Riscos e decisões pendentes

### Riscos

`[RISCO]` `pgcrypto` habilitado não resolve custódia; usar chave no banco pode
expô-la em logs ou statement logs.

`[RISCO]` Vazamento por logs de Edge/SQL, APM, erros, exports e backups.

`[RISCO]` Perda de dados por backup do banco sem a chave ou destruição prematura
da versão antiga.

`[RISCO]` Indisponibilidade ou dependência de KMS externo ou de Edge secrets não
confirmados.

`[RISCO]` Falha operacional em recriptografia em lote, inconsistência de HMAC,
falha de decrypt ou ausência de teste de recuperação.

`[RISCO]` Dependência de segurança, jurídico, infraestrutura, Master disponível,
segundo aprovador, ambiente não produtivo e auditoria confiável.

### Decisões ainda não aprovadas

`[PENDENTE]` Escolher a custódia: KMS/HSM externo, Edge secret ou `pgcrypto` como
fallback com risco explícito.

`[PENDENTE]` Definir o local da criptografia: Edge Function ou RPC no banco. Isso
determina se a chave transita pelo Postgres.

`[PENDENTE]` Definir a hierarquia: chave única versus KEK/DEK; DEK por versão ou
por registro.

`[PENDENTE]` Definir owner, custodiante, aprovador e substituto do Master no
break-glass.

`[PENDENTE]` Definir periodicidade de rotação, janela de retenção da chave antiga
e estratégia de rotação do pepper HMAC.

`[PENDENTE]` Definir meio, local, duplo controle, imutabilidade e frequência de
teste do backup.

`[PENDENTE]` Definir RTO/RPO do teste de recuperação; não presumir valores.

`[PENDENTE]` Definir retenção e periodicidade de revisão da auditoria, sem
inventar prazo legal.

`[PENDENTE]` Validar juridicamente retenção, descarte e notificação de incidente.

`[PENDENTE]` Decidir se o CPF completo permanece adiado ou avança somente após
custódia e recuperação validadas.

`[PENDENTE]` Definir e disponibilizar ambiente não produtivo para o teste de
recuperação.

## Critérios para encerrar PRIV2 e PRIV4

`[PROPOSTA]` PRIV2 somente pode ser encerrado se:

- houver custódia de chave definida e validada;
- a escolha respeitar a matriz: Vault/Edge primeiro; se indisponíveis, o CPF
  completo permanece adiado; KMS/HSM exige decisão explícita e atualização da
  matriz;
- a chave ficar fora do banco, frontend, repositório e `platform_settings`;
- criptografia e pepper HMAC estiverem separados e versionados;
- houver controle de acesso, auditoria e redaction de logs;
- o mecanismo escolhido estiver confirmado no ambiente hospedado;
- houver decisão explícita de risco se `pgcrypto` for usado como fallback;
- não houver dependência de Vault inexistente ou não confirmado.

`[PROPOSTA]` PRIV4 somente pode ser encerrado se:

- o runbook estiver aprovado;
- houver owner, custodiante e aprovador definidos;
- o break-glass estiver documentado e auditável;
- o backup da chave estiver separado do banco e testado;
- houver teste de recuperação em ambiente não produtivo com dados sintéticos;
- houver evidência de ausência de plaintext.

`[PENDENTE]` Retenção, descarte e notificação de incidente permanecem condições
transversais de PRIV8; não são critérios de encerramento de PRIV4.

`[OBSERVADO]` Com o contexto atual, PRIV2 e PRIV4 permanecem condicionados. Nada
está aprovado ou encerrado.

## Próxima etapa sugerida

1. Decidir a custódia da chave respeitando a matriz: Vault/Edge primeiro; se
   indisponíveis, adiar o CPF completo. KMS/HSM exige decisão explícita e
   atualização da matriz; `pgcrypto` exige aceitação explícita de risco. Não
   escolher `pgcrypto` como primeira opção.
2. Validar com segurança e jurídico os papéis, a retenção, o descarte e a
   resposta a incidente.
3. Se autorizado, transformar esta proposta em runbook formal aprovado, sem
   alterar a matriz de decisões.
4. Executar somente o teste de recuperação em ambiente não produtivo com dados
   sintéticos.
5. Só então reavaliar PRIV2 e PRIV4.

## Limites deste documento

`[OBSERVADO]` Este documento não altera a matriz, o código, as migrations, o
banco, as configurações, os secrets, os testes ou a infraestrutura.

`[OBSERVADO]` Nenhuma chave foi criada, revelada, gerada ou rotacionada. Nenhuma
operação criptográfica foi executada no banco hospedado. Nenhum dado real de
cliente foi acessado.

`[OBSERVADO]` PRIV2 e PRIV4 não estão encerrados. O armazenamento de CPF completo
permanece adiado.
