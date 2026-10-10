// DELLVERY 3 — Auth da área Master (puro, sem rede; testável via node:test).
// - Aceita e-mail ou apelido local (ex.: "sciamponi" resolve para o e-mail
//   da conta do responsável, sem nunca autenticar só pelo apelido: o login
//   continua via Supabase Auth com e-mail + senha).
// - Classifica falhas para mensagens distintas (credencial, rede, permissão).

// Apelidos locais → e-mail da conta. Somente atalho de digitação; a senha
// continua obrigatória e verificada pelo Supabase Auth.
export const MASTER_EMAIL_ALIASES = {
  sciamponi: 'sciamponi@gmail.com',
};

export function resolveMasterIdentifier(input, aliases = MASTER_EMAIL_ALIASES) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) return raw.toLowerCase();
  const hit = Object.entries(aliases || {}).find(
    ([alias]) => alias.toLowerCase() === raw.toLowerCase(),
  );
  return hit ? hit[1] : '';
}

// Classifica o erro do login/permissão em códigos estáveis para a UI.
export function classifyMasterAuthError(err) {
  const code = err?.code || err?.error_code || '';
  const msg = `${err?.message || err?.msg || err || ''}`.toLowerCase();
  if (
    code === 'invalid_credentials'
    || msg.includes('invalid login credentials')
    || msg.includes('invalid login')
    || msg.includes('e-mail ou senha')
  ) return 'invalid';
  if (
    code === 'email_not_confirmed'
    || msg.includes('not confirmed')
    || msg.includes('confirm')
  ) return 'unconfirmed';
  if (
    msg.includes('failed to fetch')
    || msg.includes('fetch failed')
    || msg.includes('network')
    || msg.includes('conexão')
    || code === 'ETIMEDOUT'
    || code === 'ECONNREFUSED'
  ) return 'network';
  if (msg.includes('restrito') || msg.includes('permiss')) return 'denied';
  return 'unknown';
}

export const MASTER_AUTH_MESSAGES = {
  invalid: 'E-mail/usuário ou senha inválidos. Confira e tente de novo.',
  unconfirmed: 'Conta ainda não confirmada. Verifique seu e-mail.',
  network: 'Sem conexão com o servidor. Verifique se o Supabase local está ativo e tente de novo.',
  denied: 'Esta área é exclusiva do administrador da plataforma.',
  unknown: 'Não foi possível entrar. Tente de novo.',
};

export function masterAuthMessage(err) {
  return MASTER_AUTH_MESSAGES[classifyMasterAuthError(err)] || MASTER_AUTH_MESSAGES.unknown;
}
