// DELLVERY 3 — Selo de pagamento (puro, testável).
// Hierarquia de verdade: status oficial primeiro; declaração em auditoria
// NUNCA vira PAGO. Sem método: sem emoji (sem excesso).
// - paid => 🟢 PAGO (verde), independente de declaração.
// - hasReceipt (sem quitação) => 🟡 REGISTRADO (âmbar sólido).
// - failed => ❌ PAGAMENTO FALHOU (vermelho).
// - refunded => ↩️ ESTORNADO (cinza).
// - demais => 🔴 A RECEBER (vermelho).

export function paymentMethodIcon(method) {
  const m = String(method || '').toLowerCase();
  if (!m) return '';
  if (m.includes('pix')) return '🟢';
  if (m.includes('cart')) return '💳';
  if (m.includes('dinheiro')) return '💵';
  return '';
}

export function paymentBadgeState({ paymentStatus, hasReceipt = false } = {}) {
  if (paymentStatus === 'paid') {
    return { key: 'paid', label: 'PAGO', icon: '🟢', tone: 'green' };
  }
  if (hasReceipt) {
    return { key: 'registered', label: 'REGISTRADO', icon: '🟡', tone: 'amber' };
  }
  if (paymentStatus === 'failed') {
    return { key: 'failed', label: 'PAGAMENTO FALHOU', icon: '❌', tone: 'red' };
  }
  if (paymentStatus === 'refunded') {
    return { key: 'refunded', label: 'ESTORNADO', icon: '↩️', tone: 'gray' };
  }
  return { key: 'pending', label: 'A RECEBER', icon: '🔴', tone: 'red' };
}

const TONE_CLASSES = {
  green: 'bg-green-600 text-white',
  red: 'bg-red-600 text-white',
  amber: 'bg-amber-500 text-white',
  gray: 'bg-muted text-muted-foreground',
};

/** Classes do selo a partir do estado (para Tailwind). */
export function paymentBadgeClass(state) {
  return TONE_CLASSES[state?.tone] || TONE_CLASSES.gray;
}
