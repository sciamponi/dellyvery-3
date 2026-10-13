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

// Modelo do contrato (prévia + impressão + snapshot). Congela valores;
// não busca nada externo.
export function buildContractModel(adhesion, plan) {
  const a = adhesion || {};
  const p = a.provider && typeof a.provider === 'object' ? a.provider : {};
  const addr = a.address && typeof a.address === 'object' ? a.address : {};
  const addrLine = [addr.street, addr.number, addr.complement, addr.neighborhood, addr.city, addr.state, addr.zip]
    .filter((x) => String(x || '').trim()).join(' • ');
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
