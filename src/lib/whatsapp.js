// DELLVERY 3 — Links wa.me para captação comercial (puro, sem deps).
// Número comercial configurado no projeto (página pública de planos):
// (11) 93231-4551 → 5511932314551. Não inventar outro número: se mudar,
// atualizar COMMERCIAL_WHATSAPP aqui e na página de planos.
// Abrir a conversa NÃO altera status do cadastro (sem efeito colateral).

export const COMMERCIAL_WHATSAPP = '5511932314551';

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

// Normaliza telefone do interessado (10/11 dígitos) para wa.me (com DDI 55).
// Se já vier com DDI (12/13 dígitos iniciando com 55), preserva.
export function toWaNumber(phone) {
  const d = onlyDigits(phone);
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return '';
}

export function buildWaUrl(number, message) {
  const to = onlyDigits(number);
  if (!to) throw new Error('Número de WhatsApp inválido');
  return `https://wa.me/${to}?text=${encodeURIComponent(message || '')}`;
}

// Mensagem do VISITANTE para o comercial (após salvar o cadastro).
// Fala como o interessado; não afirma proposta aprovada nem pagamento pendente.
export function buildLeadInboundMessage({ name, serviceLabel, plan, billingLabel, paymentLabel }) {
  const lines = [
    `Olá! Sou ${name || 'interessado(a)'}.`,
    `Acabei de registrar meu interesse${serviceLabel ? ` em ${serviceLabel}` : ''}${plan ? ` (plano: ${plan})` : ''}.`,
  ];
  if (billingLabel) lines.push(`Periodicidade desejada: ${billingLabel}.`);
  if (paymentLabel) lines.push(`Minha preferência de pagamento é ${paymentLabel}.`);
  lines.push('Quero dar continuidade ao atendimento e receber a proposta comercial.');
  return lines.join('\n');
}

// Mensagem do ADMIN para o interessado (painel Master, por cadastro).
// Fala como a equipe; propõe contato e proposta, sem afirmar aprovação/pagamento.
export function buildAdminFollowUpMessage({ name, serviceLabel, plan, billingLabel, paymentLabel, phone, email }) {
  const first = String(name || '').trim().split(/\s+/)[0] || 'tudo bem?';
  const planPart = `${plan ? `, referente ao plano ${plan}` : ''}${billingLabel ? ` (${billingLabel})` : ''}`;
  const lines = [
    `Olá, ${first}! Recebemos sua solicitação de interesse${serviceLabel ? ` em ${serviceLabel}` : ' no Dellyvery'}${planPart}.`,
    'Vou entrar em contato para apresentar a proposta comercial e explicar as condições de contratação.',
  ];
  if (paymentLabel) {
    lines.push(`Vi que sua preferência é ${paymentLabel} — após alinharmos os detalhes, encaminho as informações para pagamento, se essa for a modalidade escolhida.`);
  } else {
    lines.push('Após alinharmos os detalhes, encaminho as informações para pagamento, conforme a modalidade escolhida.');
  }
  if (phone || email) lines.push(`Referência do cadastro: ${[phone, email].filter(Boolean).join(' • ')}.`);
  lines.push('Obrigado pelo interesse!');
  return lines.join('\n');
}

// URL visitante → comercial (botão pós-cadastro).
export function buildLeadInboundUrl({ name, serviceLabel, plan, billingLabel, paymentLabel }) {
  return buildWaUrl(
    COMMERCIAL_WHATSAPP,
    buildLeadInboundMessage({ name, serviceLabel, plan, billingLabel, paymentLabel }),
  );
}

// URL admin → interessado (painel Master, por cadastro).
export function buildLeadFollowUpUrl(lead) {
  const to = toWaNumber(lead?.phone);
  if (!to) throw new Error('Cadastro sem telefone válido para WhatsApp');
  return buildWaUrl(
    to,
    buildAdminFollowUpMessage({
      name: lead?.full_name || lead?.company_name,
      serviceLabel: lead?.service,
      plan: lead?.plan_interest,
      billingLabel: lead?.billing_period,
      paymentLabel: lead?.payment_preference,
      phone: lead?.phone,
      email: lead?.email,
    }),
  );
}
