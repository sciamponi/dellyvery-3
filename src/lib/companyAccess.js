export const COMPANY_ACCESS_STATUS = {
  ACTIVE: 'active',
  EXPIRED: 'expired',
  MASTER: 'master',
  RESELLER: 'reseller',
  PENDING: 'pending',
  MISSING_COMPANY: 'missing-company',
  NO_COMPANY: 'no-company',
  NO_USER: 'no-user',
  ACCESS_ERROR: 'access-error',
};

export const COMPANY_ACTIVE_ACCESS_TIMEOUT_MS = 10000;

export async function readCompanyActiveAccess(loader, { timeoutMs = COMPANY_ACTIVE_ACCESS_TIMEOUT_MS } = {}) {
  if (typeof loader !== 'function') {
    throw new TypeError('Carregador de acesso da empresa invalido');
  }

  let timer;
  try {
    const result = await Promise.race([
      Promise.resolve().then(loader),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Tempo esgotado ao verificar o acesso da empresa')),
          Math.max(1, timeoutMs),
        );
      }),
    ]);

    if (result === true || result === false) return result;
    throw new Error('Resposta invalida ao verificar o acesso da empresa');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function shouldRenderCompanyPanel(status) {
  return status === COMPANY_ACCESS_STATUS.ACTIVE;
}

export function resolveCompanyAccess({
  hasCompany = false,
  companyActive = null,
  adminStatus = 'denied',
  resellerStatus = 'denied',
  clientStatus = null,
} = {}) {
  if (hasCompany && companyActive === true) return COMPANY_ACCESS_STATUS.ACTIVE;

  if (adminStatus === 'allowed') return COMPANY_ACCESS_STATUS.MASTER;

  if (resellerStatus === 'allowed' || resellerStatus === 'suspended') {
    return COMPANY_ACCESS_STATUS.RESELLER;
  }
  if (adminStatus === 'network' || adminStatus === 'error') {
    return COMPANY_ACCESS_STATUS.ACCESS_ERROR;
  }
  if (resellerStatus === 'network' || resellerStatus === 'error') {
    return COMPANY_ACCESS_STATUS.ACCESS_ERROR;
  }

  if (hasCompany) return COMPANY_ACCESS_STATUS.EXPIRED;

  if (!clientStatus) return COMPANY_ACCESS_STATUS.NO_COMPANY;
  if (clientStatus === 'pending') return COMPANY_ACCESS_STATUS.PENDING;
  if (clientStatus === 'expired') return COMPANY_ACCESS_STATUS.EXPIRED;
  if (clientStatus === 'active') return COMPANY_ACCESS_STATUS.MISSING_COMPANY;
  return COMPANY_ACCESS_STATUS.PENDING;
}
