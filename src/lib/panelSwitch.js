// DELLVERY 3 - Troca de contexto entre Cliente, Master e Revendedor.
// A funcao apenas decide o que exibir; as rotas continuam validando a
// autorizacao real. Master administrativo nao implica acesso de revenda.

export const PANEL_KEYS = ['client', 'master', 'reseller'];

export function currentPanelFromPath(pathname) {
  if (typeof pathname !== 'string') return 'client';
  if (pathname === '/master' || pathname.startsWith('/master/')) return 'master';
  if (pathname === '/revenda' || pathname.startsWith('/revenda/')) return 'reseller';
  return 'client';
}

export function availablePanels({
  isAdmin = false,
  isReseller = false,
  currentPanel = 'client',
} = {}) {
  return PANEL_KEYS.filter((panel) => {
    if (panel === 'client') return true;
    // O contexto atual ja passou pelo gate da propria rota. Manter o item
    // evita sumir da interface enquanto a checagem paralela ainda carrega.
    if (panel === 'master') return isAdmin || currentPanel === 'master';
    if (panel === 'reseller') return isReseller || currentPanel === 'reseller';
    return false;
  });
}
