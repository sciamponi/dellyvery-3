// DELLYVERY 3 — Gate Master (puro, sem rede/React).
// Distingue falta de permissão de falha de rede/erro inesperado e permite
// que "Tentar de novo" incremente a tentativa para refazer a consulta.

export const MASTER_GATE_INITIAL = {
  status: 'idle',
  error: '',
  attempt: 0,
};

export function createMasterGateState() {
  return { ...MASTER_GATE_INITIAL };
}

export function classifyMasterAccessError(error) {
  const code = String(error?.code || error?.error_code || '');
  const msg = String(error?.message || error || '').toLowerCase();
  if (
    code === 'ETIMEDOUT'
    || code === 'ECONNREFUSED'
    || code === 'ENOTFOUND'
    || code === 'EAI_AGAIN'
    || msg.includes('failed to fetch')
    || msg.includes('fetch failed')
    || msg.includes('network')
    || msg.includes('timeout')
    || msg.includes('conexão')
  ) return 'network';
  return 'error';
}

export function masterGateReducer(state, action) {
  switch (action.type) {
    case 'check:start':
      return { ...state, status: 'checking', error: '' };
    case 'check:result':
      return { ...state, status: action.status, error: action.error || '' };
    case 'check:retry':
      return { ...state, status: 'checking', error: '', attempt: state.attempt + 1 };
    case 'check:reset':
      return { ...MASTER_GATE_INITIAL };
    default:
      return state;
  }
}
