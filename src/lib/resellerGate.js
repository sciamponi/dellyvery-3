// DELLVERY 3 - Gate da area do revendedor (puro, sem rede/React).
// Distingue falta de vinculo de suspensao e de falha de rede, para que a rota
// /revenda nunca dependa apenas da protecao visual do frontend.

export const RESELLER_GATE_INITIAL = {
  status: 'idle',
  error: '',
  attempt: 0,
  reseller: null,
};

export function createResellerGateState() {
  return { ...RESELLER_GATE_INITIAL };
}

export function classifyResellerAccessError(error) {
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
    || msg.includes('conex')
  ) return 'network';
  return 'error';
}

export function resellerGateReducer(state, action) {
  switch (action.type) {
    case 'check:start':
      return { ...state, status: 'checking', error: '', reseller: null };
    case 'check:result':
      return {
        ...state,
        status: action.status,
        error: action.error || '',
        reseller: action.reseller || null,
      };
    case 'check:retry':
      return { ...state, status: 'checking', error: '', attempt: state.attempt + 1, reseller: null };
    case 'check:reset':
      return { ...RESELLER_GATE_INITIAL };
    default:
      return state;
  }
}
