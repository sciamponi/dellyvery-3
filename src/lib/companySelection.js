// DELLVERY 3 — Seleção da empresa atual (lógica pura, FASE 5.1)
// Sem efeitos colaterais: recebe memberships + id salvo e decide.
// "Não inventar múltiplas empresas se o usuário possuir apenas uma":
// com 0 ou 1 membership, o resultado é determinístico.

export const companyStorageKey = (userId) => `dellyvery:company:${userId}`;

export function resolveCurrentCompany(memberships, savedId) {
  const list = Array.isArray(memberships) ? memberships.filter((m) => m && m.company) : [];
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  if (savedId) {
    const found = list.find((m) => m.companyId === savedId || m.company?.id === savedId);
    if (found) return found;
  }
  return null; // >1 empresa e nenhuma seleção válida → UI deve pedir escolha
}

export function loadSavedCompanyId(storage, userId) {
  try {
    return storage?.getItem(companyStorageKey(userId)) || null;
  } catch {
    return null;
  }
}

export function saveCompanyId(storage, userId, companyId) {
  try {
    if (companyId) storage?.setItem(companyStorageKey(userId), companyId);
    else storage?.removeItem(companyStorageKey(userId));
  } catch {
    // storage indisponível (SSR/privado): seleção segue só em memória
  }
}
