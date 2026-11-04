export const MASTER_REVENDA_PATHS = {
  gestao: '/master/revenda',
  creditos: '/master/revenda/creditos',
  compras: '/master/revenda/compras',
};

export function masterRevendaTabFromPath(pathname) {
  if (typeof pathname !== 'string') return null;
  const path = pathname.replace(/\/+$/, '') || '/';
  if (
    path === '/master/compras'
    || path === MASTER_REVENDA_PATHS.compras
    || path.startsWith(`${MASTER_REVENDA_PATHS.compras}/`)
  ) return 'compras';
  if (
    path === MASTER_REVENDA_PATHS.creditos
    || path.startsWith(`${MASTER_REVENDA_PATHS.creditos}/`)
  ) return 'creditos';
  if (path === MASTER_REVENDA_PATHS.gestao) return 'gestao';
  return null;
}
