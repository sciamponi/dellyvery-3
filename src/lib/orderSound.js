import newOrderAlertUrl from '@/assets/new-order-alert.wav';

let audioCtx = null;
let alertAudio = null;
let audioUnlocked = false;
let lastPlayAt = 0;
let queuedPlay = null;

// Desbloqueia o áudio no primeiro gesto do usuário (política de autoplay).
function ensureUnlock() {
  if (audioUnlocked) return;
  const unlock = () => {
    audioUnlocked = true;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (e) { /* ignore */ }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
ensureUnlock();

function getAlertAudio() {
  if (!alertAudio) {
    alertAudio = new Audio(newOrderAlertUrl);
    alertAudio.preload = 'auto';
  }
  return alertAudio;
}

// Bipes WebAudio originais — fallback se o arquivo falhar.
export function playOrderSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') { audioCtx.resume(); return; }
    const now = audioCtx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      const start = now + i * 0.15;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch (e) { /* Audio not supported */ }
}

/**
 * Alerta sonoro de "novo pedido" (arquivo do projeto, sem URL externa).
 * - Um som por chamada, sem sobreposição: chamadas com <800ms de intervalo
 *   são reagendadas em sequência em vez de tocarem juntas.
 * - Nunca gera erro se o navegador bloquear (mantém só o alerta visual).
 */
export function playNewOrderAlert() {
  try {
    const now = Date.now();
    const gap = now - lastPlayAt;
    if (gap < 800) {
      if (queuedPlay) clearTimeout(queuedPlay);
      queuedPlay = setTimeout(() => {
        queuedPlay = null;
        playNewOrderAlert();
      }, 800 - gap);
      return;
    }
    lastPlayAt = now;
    const audio = getAlertAudio();
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => playOrderSound());
    }
  } catch (e) {
    try { playOrderSound(); } catch (e2) { /* visual apenas */ }
  }
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    const result = await Notification.requestPermission();
    return result === 'granted';
  }
  return false;
}

export function showOrderNotification(order) {
  if (Notification.permission === 'granted') {
    const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(order.total || 0);
    new Notification('Novo pedido recebido!', {
      body: `#${order.order_number} - ${order.customer_name} - ${fmt}`,
    });
  }
}
