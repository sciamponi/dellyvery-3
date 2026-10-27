import { buildTableQrUrl } from './tableQr.js';

// DELLVERY 3 — Modelo do material impresso de divulgação (puro, testável).
// Sem preços, nomes ou promoções inventados: tudo vem de company/products.
// Sem token: material geral (sem mesa). Com mesa: nome + token estável.

export const DEFAULT_TABLE_TITLE = 'Peça direto da sua mesa!';
export const DEFAULT_GENERAL_TITLE = 'Peça pelo QR Code!';
export const DEFAULT_INSTRUCTION =
  'Aponte a câmera do celular para o QR Code, escolha seus produtos e envie seu pedido.';

export function menuUrlFor(origin, slug) {
  if (!origin || !slug) throw new Error('Loja não identificada');
  return `${String(origin).replace(/\/+$/, '')}/cardapio/${slug}`;
}

// Até 3 fotos reais; manuais (ids) têm prioridade. Com autoFill (padrão,
// compatível), completa com as primeiras com imagem; com false, SÓ manuais
// (sem surpresa: nenhuma foto automática inesperada). Nunca inventa URL.
export function pickProductPhotos(products, manualIds = [], limit = 3, autoFill = true) {
  const list = Array.isArray(products) ? products : [];
  const byId = new Map(list.map((p) => [p.id, p]));
  const picked = [];
  for (const id of manualIds || []) {
    const p = byId.get(id);
    if (p?.image_url && !picked.some((x) => x.id === p.id)) picked.push(p);
    if (picked.length >= limit) break;
  }
  if (autoFill && picked.length < limit) {
    for (const p of list) {
      if (picked.length >= limit) break;
      if (p?.image_url && !picked.some((x) => x.id === p.id)) picked.push(p);
    }
  }
  return picked.slice(0, limit);
}

export function buildFlyerModel({ company, products = [], table = null, origin, opts = {} }) {
  if (!company?.slug) throw new Error('Loja não identificada');
  if (!origin) throw new Error('Origem inválida');
  const slug = company.slug;
  const qrUrl = table?.public_token
    ? buildTableQrUrl(origin, slug, table.public_token)
    : menuUrlFor(origin, slug);
  return {
    kind: table ? 'table' : 'general',
    companyName: company.name || '',
    logoUrl: company.logo_url || '',
    coverUrl: company.cover_url || '',
    primaryColor: company.primary_color || '#DC2626',
    tableName: table?.name || '',
    title: opts.title || (table ? DEFAULT_TABLE_TITLE : DEFAULT_GENERAL_TITLE),
    instruction: opts.instruction || DEFAULT_INSTRUCTION,
    qrUrl,
    photos: pickProductPhotos(products, opts.photoIds, 3, opts.autoPhotos !== false),
  };
}

// Render PNG do flyer em canvas (1080x1350). Falha de imagem/rede não
// derruba: espaços vazios. Retorna dataURL PNG. onMissing (opcional):
// avisado com { cover, photos } quando capa/fotos falham (CORS/rede).
export async function renderFlyerPng(model, { qrDataUrl, onMissing } = {}) {
  if (!model) throw new Error('Modelo inválido');
  if (!qrDataUrl) throw new Error('QR Code não gerado');
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const x = canvas.getContext('2d');
  const load = (src) => new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
  const cover = await load(model.coverUrl);
  const missing = { cover: !!model.coverUrl && !cover, photos: 0 };
  if (cover) {
    const s = Math.max(W / cover.width, (H * 0.42) / cover.height);
    const w = cover.width * s;
    const h = cover.height * s;
    x.drawImage(cover, (W - w) / 2, 0, w, h);
    x.fillStyle = 'rgba(0,0,0,0.45)';
    x.fillRect(0, 0, W, H * 0.42);
  } else {
    x.fillStyle = model.primaryColor || '#DC2626';
    x.fillRect(0, 0, W, H * 0.42);
  }
  x.fillStyle = '#ffffff';
  x.fillRect(0, H * 0.42, W, H * 0.58);
  const center = (text, y, size, color, bold = true) => {
    x.fillStyle = color;
    x.font = `${bold ? '800' : '400'} ${size}px Inter, system-ui, sans-serif`;
    x.textAlign = 'center';
    x.fillText(text, W / 2, y);
  };
  center(model.companyName || '', 120, 54, '#ffffff');
  center(model.title, 200, 62, '#ffd9a8');
  if (model.kind === 'table' && model.tableName) {
    center(`Mesa ${model.tableName}`, 268, 44, '#ffffff', false);
  }
  const qr = await load(qrDataUrl);
  const QS = 430;
  const qx = (W - QS) / 2;
  const qy = 380;
  x.fillStyle = '#ffffff';
  x.fillRect(qx - 24, qy - 24, QS + 48, QS + 48);
  if (qr) x.drawImage(qr, qx, qy, QS, QS);
  x.fillStyle = '#333333';
  x.font = '400 30px Inter, system-ui, sans-serif';
  x.textAlign = 'center';
  wrapText(x, model.instruction, W / 2, 900, W - 160, 38);
  const thumbs = await Promise.all((model.photos || []).map((p) => load(p.image_url)));
  const valid = thumbs.filter(Boolean);
  missing.photos = (model.photos || []).length - valid.length;
  if (typeof onMissing === 'function' && (missing.cover || missing.photos > 0)) {
    try { onMissing(missing); } catch { /* aviso best-effort */ }
  }
  valid.forEach((img, i) => {
    const S = 200;
    const total = valid.length * (S + 24) - 24;
    const sx = (W - total) / 2 + i * (S + 24);
    x.save();
    x.beginPath();
    x.roundRect(sx, 1090, S, S, 24);
    x.clip();
    const s = Math.max(S / img.width, S / img.height);
    x.drawImage(img, sx + (S - img.width * s) / 2, 1090 + (S - img.height * s) / 2, img.width * s, img.height * s);
    x.restore();
  });
  return canvas.toDataURL('image/png');
}

function wrapText(x, text, cx, y, maxW, lh) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  let line = '';
  let yy = y;
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (x.measureText(t).width > maxW && line) {
      x.fillText(line, cx, yy);
      line = w;
      yy += lh;
    } else {
      line = t;
    }
  }
  if (line) x.fillText(line, cx, yy);
  return yy;
}
