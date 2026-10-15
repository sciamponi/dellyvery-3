// DELLVERY 3 — Matriz RBAC proposta para operações de pedidos/catálogo.
// PROPOSTA (Fase D), SEM enforcement: nada neste arquivo altera o
// comportamento atual. O backend hoje autoriza qualquer membro ativo em
// status/cancel/edit/desconto/atribuições (ver manage_order e RLS); Jenn
// team.manage e tables delete já são OWNER/ADMIN (policy + UI Equipe).
// Aplicar a matriz abaixo exige migration + autorização explícita, pois
// OPERATOR/CASHIER/ATTENDANT perderiam operações que a UI libera hoje
// (ver impactVsToday). Papéis: TEAM_ROLE_ORDER em src/api/team.js.

export const OPS_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'CASHIER', 'ATTENDANT'];

export const OPERATIONS = [
  'order.view',
  'order.status',
  'order.assign',
  'order.cancel',
  'order.edit',
  'order.discount',
  'catalog.write',
  'tables.write',
  'team.manage',
];

// Proposta: quem PODE (membro ativo; platform admin sempre pode).
export const PROPOSED_POLICY = {
  'order.view': ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR', 'CASHIER', 'ATTENDANT'],
  'order.status': ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'],
  'order.assign': ['OWNER', 'ADMIN', 'MANAGER', 'OPERATOR'],
  'order.cancel': ['OWNER', 'ADMIN', 'MANAGER'],
  'order.edit': ['OWNER', 'ADMIN', 'MANAGER'],
  'order.discount': ['OWNER', 'ADMIN'],
  'catalog.write': ['OWNER', 'ADMIN', 'MANAGER'],
  'tables.write': ['OWNER', 'ADMIN', 'MANAGER'],
  'team.manage': ['OWNER', 'ADMIN'],
};

// Comportamento ATUAL (evidência no código desta base):
// escrita operacional liberada a qualquer membro ativo; team.manage e
// tables delete já restritos. driver_payouts já exige OWNER/ADMIN/MANAGER
// (políticas payouts_write_mgr) — referência de enforcement existente.
export const CURRENT_POLICY = {
  'order.view': [...OPS_ROLES],
  'order.status': [...OPS_ROLES],
  'order.assign': [...OPS_ROLES],
  'order.cancel': [...OPS_ROLES],
  'order.edit': [...OPS_ROLES],
  'order.discount': [...OPS_ROLES],
  'catalog.write': [...OPS_ROLES],
  'tables.write': ['OWNER', 'ADMIN', 'MANAGER'],
  'team.manage': ['OWNER', 'ADMIN'],
};

export function canDo(policy, role, op) {
  if (!OPS_ROLES.includes(role)) return false;
  const allowed = policy[op];
  return Array.isArray(allowed) && allowed.includes(role);
}

/** Compatibilidade: operações abertas hoje que a proposta fecharia, por papel. */
export function impactVsToday() {
  const impact = {};
  for (const role of OPS_ROLES) {
    impact[role] = OPERATIONS.filter(
      (op) => canDo(CURRENT_POLICY, role, op) && !canDo(PROPOSED_POLICY, role, op),
    );
  }
  return impact;
}
