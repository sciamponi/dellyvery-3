import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Storefront público (FASE 5.4-C C8)
// Usa SOMENTE get_storefront_by_slug(). Nunca SELECT direto em tabelas
// (Menu/Checkout são anônimos; RLS não abre leitura pública).
const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

export async function getStorefrontBySlug(client, slug) {
  const c = mustBeConfigured(client);
  if (!slug) throw new Error('Loja não encontrada');
  const { data, error } = await c.rpc('get_storefront_by_slug', { p_slug: slug });
  if (error) {
    if (/Loja não encontrada/i.test(error.message)) {
      const err = new Error('Loja não encontrada');
      err.code = 'NOT_FOUND';
      throw err;
    }
    throw new Error(error.message || 'Erro ao carregar cardápio');
  }
  return data;
}
