import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Supabase Storage (FASE 5.5-B2)
// Buckets: avatars (user_id/), logos + catalog (company_id/),
// platform-assets (pix-qr/, somente Master).
// Limite da aplicação: 5 MB (bucket limita 8 MB contra bypass fora da UI).
// MIME: jpeg/png/webp. Sem service_role; RLS do storage autoriza.

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export const PLATFORM_ASSETS_BUCKET = 'platform-assets';
export const PIX_QR_FOLDER = 'pix-qr';

export const BUCKET_BY_KIND = {
  avatar: 'avatars',
  logo: 'logos',
  cover: 'logos',
  catalog: 'catalog',
  pix_qr: PLATFORM_ASSETS_BUCKET,
};

export function validateUploadFile(file) {
  if (!file) throw new Error('Arquivo não informado');
  if (!ALLOWED_MIME.includes(file.type)) {
    throw new Error('Formato inválido. Use JPG, PNG ou WebP.');
  }
  const size = file.size ?? 0;
  if (size <= 0) throw new Error('Arquivo vazio');
  if (size > MAX_UPLOAD_BYTES) throw new Error('Arquivo maior que 5MB');
}

export function extensionFor(file) {
  const map = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  return map[file.type] || 'jpg';
}

export function randomId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// kind: avatar (ownerId=userId) | logo/catalog (ownerId=companyId) | pix_qr (ownerId=PIX_QR_FOLDER)
export function buildUploadPath(kind, ownerId, file, id = randomId()) {
  const bucket = BUCKET_BY_KIND[kind];
  if (!bucket) throw new Error('Tipo de upload inválido');
  if (!ownerId) throw new Error('Dono do arquivo não definido');
  return { bucket, path: `${ownerId}/${id}.${extensionFor(file)}` };
}

export function getPixQrPublicUrl(client, path) {
  const c = withClient(client);
  const normalized = String(path ?? '').trim();
  if (!c || !normalized.startsWith(`${PIX_QR_FOLDER}/`)) return '';
  const { data } = c.storage.from(PLATFORM_ASSETS_BUCKET).getPublicUrl(normalized);
  return data?.publicUrl || '';
}

export async function uploadImage(client, kind, ownerId, file) {
  const c = mustBeConfigured(client);
  validateUploadFile(file);
  const { bucket, path } = buildUploadPath(kind, ownerId, file);
  const { error } = await c.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error(error.message || 'Erro no upload');
  const { data } = c.storage.from(bucket).getPublicUrl(path);
  return { file_url: data?.publicUrl || '', bucket, path };
}

export async function deleteImage(client, bucket, path) {
  const c = mustBeConfigured(client);
  if (!bucket || !path) return false;
  const { error } = await c.storage.from(bucket).remove([path]);
  if (error) throw new Error(error.message || 'Erro ao remover arquivo');
  return true;
}
