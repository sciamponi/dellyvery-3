/**
 * Preferências de alerta de novos pedidos, por empresa + usuário.
 * Persistidas em localStorage (sem backend). OFF = sem som e sem modal
 * automático — o pedido continua chegando, notificando e visível no Kanban.
 */

const DEFAULTS = { sound: true, visual: true };

function key(companyId, userId) {
  return `dellyvery:alerts:${companyId || 'nocompany'}:${userId || 'nouser'}`;
}

export function getAlertPrefs(companyId, userId) {
  try {
    const raw = localStorage.getItem(key(companyId, userId));
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      sound: parsed.sound !== false,
      visual: parsed.visual !== false,
    };
  } catch (e) {
    return { ...DEFAULTS };
  }
}

export function setAlertPrefs(companyId, userId, prefs) {
  try {
    localStorage.setItem(key(companyId, userId), JSON.stringify({
      sound: prefs.sound !== false,
      visual: prefs.visual !== false,
    }));
  } catch (e) { /* storage indisponível */ }
}
