# Reorganização de Categorias, Complementos e Dependências (relatório técnico)

Data de execução: 2026-10-13/14 (America/Sao_Paulo).
Branch: `feat/supabase-foundation` — base `0b7462c` (Gate 3). Sem commit, push, deploy ou migration remota nesta etapa.

## 1. Auditoria prévia (resumo)

- `categories`: escopo por empresa (`company_id`), com nome, descrição, ícone, imagem, ordem, ativo. **Sem slug** → adicionado.
- `product_config_steps`: `product_id NOT NULL`, trigger de tenant por produto, RLS por `company_id`, unique `(product_id, position)`. Opções pertencem ao passo (sem mudança).
- `GestaoProdutos` tem abas Produtos/Categorias/Complementos/Dependências; `CategoryFormDialog` sem seção de grupos; `ProductFormDialog` único ponto de entrada do cadastro.
- `config_selection_total`/`get_storefront_by_slug`/`check_order_dependencies`: servidor é a autoridade; `create_order`/`manage_order` sem mudança de assinatura.
- Decisão arquitetural: **seed por restaurante (não tabela global)** — preserva RLS e isolamento; identificadores estáveis via `slug` + unique `(company_id, slug)` (padrão já usado em `companies`/`plans`).

## 2. Etapa 1 — Categorias padrão

Migration `20261022000000_category_templates.sql` (parte 1, local only):
- `categories.slug` + unique `(company_id, slug)` + índice. Personalizadas ficam com slug NULL (NULLs não conflitam).
- `seed_default_categories(company)`: Lanches 🍔, Acompanhamentos 🍟, Sobremesas 🍦, Bebidas 🍷, Combos 📦 (nomes, emojis, descrições e ordem 0–4 da especificação), `ON CONFLICT DO NOTHING` (idempotente).
- Trigger `trg_companies_seed_categories` (padrão `trg_companies_seed_order_stages`) + backfill das existentes.
- Código: `DEFAULT_CATEGORIES` + `ensureDefaultCategories` (upsert) + slug no mapeamento (leitura; patch não altera slug) em `catalog.js`; selo "Padrão" + botão "Restaurar padrão" em `GestaoProdutos`.
- Modelo atual já permitia ativar/desativar, ordenar e descrever → nenhum campo novo para isso.
- Comportamento documentado: categoria personalizada com mesmo **nome** (ex.: "Lanches" sem slug) **coexiste** com a padrão — fusão automática seria insegura para produtos associados.

## 3. Etapa 2 — Grupos por categoria + herança

Migration (parte 2): `steps.category_id` (CHK exatamente-um entre produto/categoria), `uq_step_category_position`, `products.use_category_steps` (default true), trigger de tenant estendido (produto OU categoria, mesma empresa). RLS inalterada (por `company_id`).
- Servidor: `config_selection_total` resolve união (categoria primeiro + próprios); `get_storefront_by_slug` serve config herdada com marcador `inherited` + `dependency_mode`; `create_order`/`manage_order` herdam o comportamento sem mudar assinatura. Pedidos antigos (snapshot legado) intactos.
- API (`configurator.js`): `listCategorySteps`/`createCategoryStep` (+ `moveStep` com vizinhança por escopo); `getProductConfig` une herdados (marcados) + próprios, respeitando opt-out.
- UI: `ConfigStepsEditor` aceita `categoryId` (mesma lógica/validacões, sem duplicar registros); `CategoryFormDialog` ganha seção "Grupos de complementos"; `ProductFormDialog` ganha "Usar grupos da categoria" (exceção individual; extras próprios somam).
- Exceção por produto hoje = liga/desliga herança + grupos próprios extras (suficiente e sem tabela extra).

## 4. Etapa 3 — Dependências (aba mantida, modo combo)

Aba Dependências **não misturada** com complementos. Novo: `products.dependency_mode` (`any` padrão = OR do Gate 3; `all` = todos exigidos, para combos com componentes obrigatórios; CHECK no banco).
- Servidor: `check_order_dependencies` lê o modo; `all` lista os faltantes (`A, B`); `any` mantém `A ou B`.
- Lib `productDependencies.js`: terceiro parâmetro `modes` (default `any`, 100% compatível) + `buildDepModesFromProducts`; os 5 fluxos (cardápio/modal/carrinho/checkout/PDV/edição) passam o modo.
- `DependenciesManager`: seletor "Qualquer um / Todos" por produto (persiste via produto; servidor revalida).
- Exemplo da especificação atendido: Combo (all) exigindo hambúrguer + bebida barra faltando qualquer um, no atendimento e no servidor.

## 5. Arquivos (12, todos preservados os demais)

- Nova: `supabase/migrations/20261022000000_category_templates.sql`.
- Modificados: `src/api/catalog.js` + `.test.js`, `src/api/configurator.js` + `.test.js`,
  `src/lib/productDependencies.js` + `.test.js`, `src/pages/GestaoProdutos.jsx`,
  `src/components/products/CategoryFormDialog.jsx`, `src/components/products/ConfigStepsEditor.jsx`,
  `src/components/products/ProductFormDialog.jsx`, `src/components/products/DependenciesManager.jsx`,
  `src/components/menu/ProductModal.jsx`, `src/components/menu/CartDrawer.jsx`,
  `src/pages/Checkout.jsx`, `src/pages/Pdv.jsx`, `src/components/orders/OrderModal.jsx`.
- Nenhuma tabela removida, nenhum grupo/produto/regra tocado, nenhuma migration remota.

## 6. Testes reais executados

- Suíte completa `npm run test:supabase`: **442/442 PASS** (429 base + 13 novos: defaults/slug/upsert/herança/modos nos 3 arquivos).
- `npm run build`: OK (~15s; chunk >500kB pré-existente).
- `npm run lint`: mesmos **7 erros pré-existentes** (um erro novo introduzido na sessão — `toast` duplicado — detectado e corrigido antes do final).
- SQL revisado linha a linha antes de aplicar; `node --check` nos arquivos JS.

## 7. Validação local com banco (autorização expressa do revisor) — EXECUTADA

Ordem executada: auditoria → backup (dump de schema pré-mudança em temp) → `migration up --local` (17–22, somente local) → E2E com escrita isolada → limpeza total → verificação.

- **Migration aplicada no local sem erros** (17, 18, 20, 21 pendentes + 22). Backfill semeou as 5 padrão em todas as empresas; personalizadas preservadas (ex.: `samuel` 5→10 categorias).
- **Achado durante o E2E (corrigido antes de concluir):** `create_order` sem config ignorava passos herdados obrigatórios e `manage_order/edit` rejeitava config herdada (`v_has_cfg` só olhava passos próprios). Migration estendida com réplicas fiéis de `create_order` (§6) e `manage_order` (§7) + reaplicada (repair+up, idempotente).
- **E2E 61/61 PASS** (empresa `e2e-cat-*` isolada): trigger semeia 5; re-upsert não duplica (5); herança obrigatória barra sem config e aceita com config (total com porção grátis 30; snapshot com grupo herdado); opt-out aceita; any/all (combo exige ambos, cita o faltante; total 55); legado sem passos aceita; edit-all sem exigido barra com itens preservados; edit com config herdada aceita; storefront com `requires`/`dependency_mode`/`slug`; preservação `samuel`.
- **Limpeza total verificada:** somente registros do teste removidos (pedidos+filhos, deps, steps+opções, ingrediente, produtos, categorias, seq, stages, membro, empresa, perfil, usuário auth); contagens globais de volta à baseline exata (32/9/60/87/1/1/0/1); `samuel` intacto; zero resíduo `e2e-*`.
- **Anomalia de processo (lição):** uma invocação E2E foi interrompida no meio da limpeza por pipe `Select-Object -First` (o produtor nativo morre ao fechar o pipe), deixando resíduo temporário; detectado pela verificação de contagens e removido em seguida com script dedicado. E2E deve sempre capturar saída em arquivo, nunca truncar o pipe do runner.
- Nenhuma operação remota (o `migration list` padrão tenta o remoto e foi abortado; usado `--local` em tudo).

## 8. Incidentes e pendências honestas honestas

1. **Disco C: cheio (0 bytes) no meio da sessão**: uma escrita falhou e truncou `GestaoProdutos.jsx` (0 bytes). Recuperação: arquivo restaurado do commit + mudanças reaplicadas uma a uma com verificação de conteúdo; varredura confirmou que **nenhum outro arquivo** foi afetado; usuário liberou espaço (7,4 GB) e o trabalho seguiu. Lição: verificar espaço antes de lotes de escrita.
2. **Banco local e E2E — CONCLUÍDOS (ver §7-validação).** Stack local levantado (`supabase start`), migration aplicada, E2E 61/61, limpeza verificada.
3. Cobertura: modos e herança cobertos em unidade/mocks; caminhos SQL validados por revisão (não por execução).
4. Coexistência nome×slug (§2) e exceção liga/desliga (§3) são limitações conscientes documentadas.

## 9. Próximos passos

1. Aplicar a migration no banco local e executar probes de leitura.
2. E2E de escrita (com autorização de limpeza, como no Gate 3).
3. Revisar e commitar este conjunto separadamente (não misturar com pendências de outras fases).
