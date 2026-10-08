// DELLVERY 3 — Motor de configuração de produto (FASE 4B)
// Validador único e reutilizável (fonte futura de create_order, manage_order,
// Cardápio, PDV e carrinho). Nesta fase: SOMENTE lógica pura, sem acesso a
// banco/UI/RPC. Dados do catálogo entram por injeção (linhas do banco).
//
// Contrato de entrada (nunca confia em preço/free/nome/kind/total do cliente):
//   selection = { steps: [{ step_id, items: [{ option_id, quantity }] }] }
// Regras (3A.2 + correção): min/max/soma, required, allow_repeat, free_qty
// (menor preço primeiro; desempate sort_order, option_id), snapshot v2.

export function isV2Options(options) {
  return !!options && typeof options === 'object' && !Array.isArray(options) && options.v === 2;
}

export function isLegacyOptions(options) {
  return Array.isArray(options);
}

// Leitura compatível do formato legado (array plano) — somente resumo p/
// exibição; nunca participa do cálculo novo.
export function summarizeLegacyOptions(options) {
  if (!isLegacyOptions(options)) return [];
  return options.map((c) => ({
    name: c?.option_name || c?.name || '',
    quantity: Number(c?.quantity) || 1,
    price: Number(c?.price) || 0,
  }));
}

function toIntQty(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error('Quantidade da opção deve ser inteira positiva');
  return n;
}

function baseUnitPriceOf(product) {
  if (!product) throw new Error('Produto não identificado');
  const promo = product.promotional_price;
  const base = promo != null ? Number(promo) : Number(product.price);
  if (!Number.isFinite(base) || base < 0) throw new Error('Preço base do produto inválido');
  return base;
}

/**
 * Valida a configuração e calcula totais + snapshot v2.
 * @param {object} args
 * @param {object} args.product — linha do produto ({id, company_id, price, promotional_price, active})
 * @param {Array} args.steps — linhas de product_config_steps ativas OU todas (inativas rejeitadas se selecionadas)
 * @param {Array} args.options — linhas de product_config_options (com origin: {kind, refId, active, companyId})
 * @param {object} args.selection — {steps:[{step_id, items:[{option_id, quantity}]}]}
 * @param {number} args.quantity — quantidade do produto (default 1)
 * @param {object} args.flags — {requireActiveProduct:true}
 * @returns {{baseUnitPrice, optionsTotal, unitTotal, lineTotal, quantity, freeItems, paidItems, snapshot}}
 * @throws Error com mensagem amigável em qualquer violação.
 */
export function validateProductConfig({ product, steps = [], options = [], selection = {}, quantity = 1, flags = {} } = {}) {
  if (!product || !product.id) throw new Error('Produto não identificado');
  if (flags.requireActiveProduct !== false && product.active === false) {
    throw new Error('Produto indisponível');
  }
  const productQty = Number(quantity);
  if (!Number.isInteger(productQty) || productQty < 1 || productQty > 99) {
    throw new Error('Quantidade do produto inválida');
  }
  const companyId = product.company_id || null;

  const stepsById = new Map((steps || []).map((s) => [s.id, s]));
  const optionsById = new Map((options || []).map((o) => [o.id, o]));

  const selSteps = Array.isArray(selection?.steps) ? selection.steps : [];
  const seenStepIds = new Set();
  for (const ss of selSteps) {
    if (!ss || !ss.step_id) throw new Error('Etapa não identificada');
    if (seenStepIds.has(ss.step_id)) throw new Error('Etapa selecionada mais de uma vez');
    seenStepIds.add(ss.step_id);
  }

  // Steps configuráveis do produto (só mesmas empresa/produto contam)
  const productSteps = (steps || []).filter(
    (s) => s && s.product_id === product.id && (!companyId || !s.company_id || s.company_id === companyId),
  );

  const snapshotSteps = [];
  let optionsTotal = 0;
  const freeItems = [];
  const paidItems = [];

  const resolveStep = (stepId) => {
    const st = stepsById.get(stepId);
    if (!st) throw new Error('Etapa inexistente');
    if (st.product_id !== product.id) throw new Error('Etapa pertence a outro produto');
    if (companyId && st.company_id && st.company_id !== companyId) {
      throw new Error('Etapa pertence a outra empresa');
    }
    if (st.active === false) throw new Error(`Etapa "${st.title || ''}" indisponível`);
    return st;
  };

  const resolveOption = (st, optionId, qty) => {
    const op = optionsById.get(optionId);
    if (!op) throw new Error('Opção inexistente');
    if (op.step_id !== st.id) throw new Error('Opção pertence a outra etapa');
    if (op.active === false) throw new Error(`Opção "${op.name || ''}" indisponível`);
    const origins = [op.ingredient_id || null, op.product_id || null].filter(Boolean);
    if (origins.length !== 1) throw new Error('Opção sem origem válida');
    const kind = op.ingredient_id ? 'ingredient' : 'product';
    const ref = op.origin || null;
    if (ref) {
      if (ref.active === false || ref.available === false || ref.out_of_stock === true) {
        throw new Error(`Origem da opção "${op.name || ''}" indisponível`);
      }
      const refCompany = ref.company_id || ref.companyId || null;
      if (companyId && refCompany && refCompany !== companyId) {
        throw new Error('Origem da opção pertence a outra empresa');
      }
    }
    // Preço SEMPRE do banco (options.price = adicional; nunca products.price).
    const price = Number(op.price);
    if (!Number.isFinite(price) || price < 0) throw new Error('Preço da opção inválido');
    return {
      option_id: op.id,
      kind,
      ref_id: op.ingredient_id || op.product_id,
      name: op.name || '',
      price,
      quantity: qty,
      sort_order: Number(op.sort_order) || 0,
    };
  };

  for (const st of productSteps) {
    const sel = selSteps.find((s) => s.step_id === st.id);
    const items = sel && Array.isArray(sel.items) ? sel.items : [];
    const effectiveMin = st.required ? Math.max(Number(st.min_select) || 0, 1) : (Number(st.min_select) || 0);
    const max = Number(st.max_select);

    if (items.length === 0) {
      if (st.active !== false && effectiveMin > 0) {
        if (st.required) throw new Error(`Etapa "${st.title}" é obrigatória`);
        throw new Error(`Etapa "${st.title}" exige no mínimo ${effectiveMin} escolha(s)`);
      }
      continue;
    }
    const step = resolveStep(st.id);
    if (!Number.isInteger(max) || max < 1) throw new Error(`Etapa "${step.title}" com máximo inválido`);

    // single: uma seleção lógica
    if (step.select_mode === 'single' && items.length > 1) {
      throw new Error(`Etapa "${step.title}" permite apenas 1 escolha`);
    }

    const seenOptions = new Set();
    const resolved = [];
    for (const it of items) {
      if (!it || !it.option_id) throw new Error('Opção não identificada');
      const qty = toIntQty(it.quantity ?? 1);
      if (seenOptions.has(it.option_id)) {
        throw new Error('Opção repetida na mesma etapa');
      }
      seenOptions.add(it.option_id);
      if (step.allow_repeat !== true && qty !== 1) {
        throw new Error(`Opção "${it.option_id}" não permite quantidade maior que 1`);
      }
      resolved.push(resolveOption(step, it.option_id, qty));
    }

    const totalQty = resolved.reduce((s, r) => s + r.quantity, 0);
    if (totalQty < effectiveMin) {
      throw new Error(`Etapa "${step.title}" exige no mínimo ${effectiveMin} escolha(s)`);
    }
    if (totalQty > max) {
      throw new Error(`Etapa "${step.title}" permite no máximo ${max} escolha(s)`);
    }

    // free_qty: porções de menor preço primeiro (price, sort_order, option_id).
    // Marcação por ÍNDICE (não por referência: a mesma opção pode repetir).
    const freeQty = Math.max(0, Math.min(Number(step.free_qty) || 0, max));
    const portions = [];
    for (const r of resolved) {
      for (let i = 0; i < r.quantity; i += 1) portions.push(r);
    }
    const order = portions
      .map((r, idx) => idx)
      .sort((a, b) => (portions[a].price - portions[b].price)
        || (portions[a].sort_order - portions[b].sort_order)
        || String(portions[a].option_id).localeCompare(String(portions[b].option_id)));
    const freeIdx = new Set(order.slice(0, freeQty));

    // snapshot: divide linhas free/pagas quando a quantidade mistura
    const snapItems = [];
    for (const r of resolved) {
      const occ = [];
      portions.forEach((p, idx) => { if (p === r) occ.push(idx); });
      const nFree = occ.filter((idx) => freeIdx.has(idx)).length;
      const push = (qty, free) => {
        if (qty <= 0) return;
        const entry = {
          option_id: r.option_id, kind: r.kind, ref_id: r.ref_id,
          name: r.name, price: r.price, quantity: qty, free,
        };
        snapItems.push(entry);
        if (free) freeItems.push({ ...entry, step_id: step.id, title: step.title });
        else {
          paidItems.push({ ...entry, step_id: step.id, title: step.title });
          optionsTotal += r.price * qty;
        }
      };
      push(nFree, true);
      push(r.quantity - nFree, false);
    }
    snapshotSteps.push({ step_id: step.id, title: step.title || '', items: snapItems });
  }

  // steps recebidos que não pertencem ao produto
  for (const ss of selSteps) {
    const st = stepsById.get(ss.step_id);
    if (!st || st.product_id !== product.id) throw new Error('Etapa pertence a outro produto');
  }

  const baseUnitPrice = baseUnitPriceOf(product);
  const unitTotal = baseUnitPrice + optionsTotal;
  const lineTotal = unitTotal * productQty;

  return {
    baseUnitPrice,
    optionsTotal,
    unitTotal,
    lineTotal,
    quantity: productQty,
    freeItems,
    paidItems,
    snapshot: { v: 2, steps: snapshotSteps },
  };
}

// Cálculo central reutilizável (mesmo motor, sem revalidar catálogo quando
// o chamador já validou; por padrão valida tudo).
export function calcConfiguredLineTotal(args) {
  return validateProductConfig(args);
}
