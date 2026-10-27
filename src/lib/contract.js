// DELLVERY 3 — Adesão comercial / contrato (puro, testável).
// Sem valores inventados: tudo vem da adesão registrada; pendências são
// explicitadas por missingContractFields(). Sem started/paid presumidos:
// adesão ≠ pagamento recebido.

export const ADHESION_STATUSES = [
  { id: 'rascunho', label: 'Rascunho' },
  { id: 'ativa', label: 'Ativa' },
  { id: 'suspensa', label: 'Suspensa' },
  { id: 'cancelada', label: 'Cancelada' },
];

export const ADHESION_PAYMENTS = ['Pix', 'Cartão', 'Dinheiro', 'Boleto', 'Transferência'];

export function adhesionStatusLabel(status) {
  return ADHESION_STATUSES.find((s) => s.id === status)?.label || status || '—';
}

export function fmtBRL(v) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(v) || 0);
}

export function fmtDateBR(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('pt-BR');
}

export function onlyDigits(v) {
  return String(v || '').replace(/\D/g, '');
}

// Validação de salvamento (rascunho permite incompleto; demais exigem base).
// Retorna mensagem de erro ou null. Nunca cria nada.
export function validateAdhesion(data) {
  const d = data || {};
  if (d.status !== undefined && !ADHESION_STATUSES.some((s) => s.id === d.status)) {
    return 'Situação inválida';
  }
  for (const [key, label] of [['adhesion_fee', 'Taxa de adesão'], ['monthly_fee', 'Mensalidade']]) {
    const v = d[key];
    if (v !== undefined && v !== null && v !== '' && !(Number(v) >= 0)) {
      return `${label} deve ser maior ou igual a zero`;
    }
  }
  if (d.due_day !== undefined && d.due_day !== null && d.due_day !== '') {
    const n = Number(d.due_day);
    if (!Number.isInteger(n) || n < 1 || n > 28) return 'Vencimento: dia de 1 a 28';
  }
  if (d.payment_method !== undefined && d.payment_method !== null && d.payment_method !== ''
    && !ADHESION_PAYMENTS.includes(d.payment_method)) {
    return 'Forma de pagamento inválida';
  }
  if (d.start_date !== undefined && d.start_date !== null && d.start_date !== '') {
    if (Number.isNaN(new Date(`${d.start_date}T00:00:00`).getTime())) return 'Data de início inválida';
  }
  return null;
}

// Campos pendentes para EMISSÃO do contrato (gate explícito na UI).
// Retorna lista de rótulos faltantes; vazio = pronto para emitir.
export function missingContractFields(a) {
  const m = a || {};
  const p = m.provider && typeof m.provider === 'object' ? m.provider : {};
  const missing = [];
  if (!String(m.full_name || '').trim()) missing.push('Nome da contratante');
  if (!String(m.document || '').trim()) missing.push('CPF/CNPJ da contratante');
  if (!String(m.phone || '').trim()) missing.push('Telefone da contratante');
  if (!m.plan_id) missing.push('Plano contratado');
  if (!m.start_date) missing.push('Data de início');
  if (!m.payment_method) missing.push('Forma de pagamento');
  if (!String(p.razao_social || '').trim()) missing.push('Razão social da fornecedora');
  if (!String(p.document || '').trim()) missing.push('CNPJ da fornecedora');
  if (!String(p.address || '').trim()) missing.push('Endereço da fornecedora');
  return missing;
}

// Normalização do endereço (leads jsonb + adesões).
// Aceita objeto, string JSON, string legada ou vazio; nunca devolve
// undefined nem objetos aninhados (evita `[object Object]` na UI).
// Compat: zip_code|zip|cep, aliases pt-BR e preservação de
// country/pais, reference/referencia e demais chaves simples já existentes.
export function normalizeAddress(value) {
  let obj = {};
  if (value == null) return emptyAddress();
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return emptyAddress();
    try {
      const parsed = JSON.parse(s);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        obj = parsed;
      } else {
        return { ...emptyAddress(), street: s };
      }
    } catch {
      return { ...emptyAddress(), street: s };
    }
  } else if (typeof value === 'object' && !Array.isArray(value)) {
    obj = value;
  } else {
    return emptyAddress();
  }
  const pick = (...keys) => {
    for (const k of keys) {
      const v = obj[k];
      // Objetos aninhados nunca viram texto (causa do `[object Object]`).
      if (v === undefined || v === null || typeof v === 'object') continue;
      const s = String(v).trim();
      if (s !== '' && s !== '[object Object]') return s;
    }
    return '';
  };
  const out = {
    street: pick('street', 'logradouro', 'rua', 'address', 'endereco'),
    number: pick('number', 'numero'),
    complement: pick('complement', 'complemento'),
    neighborhood: pick('neighborhood', 'bairro'),
    city: pick('city', 'cidade'),
    state: pick('state', 'uf', 'estado'),
    zip_code: pick('zip_code', 'zip', 'cep'),
    country: pick('country', 'pais', 'país'),
    reference: pick('reference', 'referencia', 'referência', 'ponto_referencia'),
  };
  // Espelho legado: adesões antigas usam `zip`.
  out.zip = out.zip_code;
  // Preserva chaves simples extras já existentes (sem objetos aninhados).
  for (const [k, v] of Object.entries(obj)) {
    if (k in out || v === undefined || v === null || typeof v === 'object') continue;
    const s = String(v).trim();
    if (s !== '') out[k] = s;
  }
  return out;
}

function emptyAddress() {
  return {
    street: '', number: '', complement: '', neighborhood: '',
    city: '', state: '', zip_code: '', zip: '', country: '', reference: '',
  };
}

// Linha de endereço para exibição/contrato: só partes preenchidas,
// sem `undefined` nem `[object Object]`.
export function formatAddressLine(addr) {
  const n = normalizeAddress(addr);
  return [
    n.street, n.number, n.complement, n.neighborhood,
    n.city, n.state, n.zip_code, n.country, n.reference,
  ].filter((x) => String(x || '').trim()).join(' • ');
}

// Merge sem perda: valores não-vazios de `override` vencem;
// vazios preservam `base`. Nunca gera objetos aninhados.
export function mergeAddress(base, override) {
  const b = normalizeAddress(base);
  const o = normalizeAddress(override);
  const keys = ['street', 'number', 'complement', 'neighborhood', 'city', 'state', 'zip_code', 'country', 'reference'];
  const out = { ...emptyAddress() };
  for (const k of keys) out[k] = o[k] || b[k] || '';
  out.zip = out.zip_code;
  const extras = new Set([...Object.keys(b), ...Object.keys(o)]);
  for (const k of extras) {
    if (k in out) continue;
    out[k] = o[k] || b[k] || '';
  }
  return out;
}

// Modelo do contrato (prévia + impressão + snapshot). Congela valores;
// não busca nada externo.
export function buildContractModel(adhesion, plan) {
  const a = adhesion || {};
  const p = a.provider && typeof a.provider === 'object' ? a.provider : {};
  const addrLine = formatAddressLine(a.address);
  return {
    contractor: {
      name: String(a.full_name || '').trim(),
      tradeName: String(a.trade_name || '').trim(),
      personType: a.person_type === 'pj' ? 'Pessoa Jurídica' : 'Pessoa Física',
      document: String(a.document || '').trim(),
      phone: String(a.phone || '').trim(),
      email: String(a.email || '').trim(),
      address: addrLine,
    },
    provider: {
      razaoSocial: String(p.razao_social || '').trim(),
      document: String(p.document || '').trim(),
      address: String(p.address || '').trim(),
      city: String(p.city || '').trim(),
      phone: String(p.phone || '').trim(),
      email: String(p.email || '').trim(),
    },
    plan: {
      name: String(a.plan_name || plan?.name || '').trim(),
      features: Array.isArray(plan?.features) ? plan.features : [],
      benefits: Array.isArray(plan?.benefits) ? plan.benefits : [],
    },
    commercial: {
      adhesionFee: Number(a.adhesion_fee) || 0,
      monthlyFee: Number(a.monthly_fee) || 0,
      discountText: String(a.discount_text || '').trim(),
      startDate: a.start_date || null,
      dueDay: a.due_day ?? null,
      paymentMethod: String(a.payment_method || '').trim(),
      status: adhesionStatusLabel(a.status),
    },
    issuedAt: new Date().toISOString(),
  };
}

// Texto para compartilhar via WhatsApp (wa.me): resumo + orientação de
// download do PDF. Não afirma envio nem validade de assinatura.
export function buildContractShareText(model) {
  const c = model?.contractor || {};
  const m = model?.commercial || {};
  const plan = model?.plan || {};
  const lines = [
    `Contrato Dellyvery — ${c.name || 'contratante'}`,
    `Plano: ${plan.name || '—'}`,
    `Adesão (única): ${fmtBRL(m.adhesionFee)}`,
    `Mensalidade: ${fmtBRL(m.monthlyFee)}`,
    m.discountText ? `Condições: ${m.discountText}` : null,
    `Início: ${fmtDateBR(m.startDate)} • Vencimento: dia ${m.dueDay ?? '—'} • Pagamento: ${m.paymentMethod || '—'}`,
    'Baixe o PDF do contrato na área Contratos e adesões para conferência e assinatura.',
  ].filter(Boolean);
  return lines.join('\n');
}
