import { supabase as defaultClient } from './supabaseClient.js';

// DELLVERY 3 — Adapter Supabase Categorias + Produtos (FASE 5.2 ETAPA B)
// company_id vem EXCLUSIVAMENTE do argumento (empresa atual do contexto
// autenticado). Nunca de payload do cliente para autorização — RLS + trigger
// `trg_products_category_company` garantem no banco; validações aqui são
// defesa em profundidade com mensagens claras.
// Mapeamentos (ETAPA A aprovada):
//   Category.order      <-> categories.sort_order
//   Product.available   <-> products.active
//   Product.complements <-> products.options
// Upload de imagem no bucket Supabase (só image_url trafega aqui).

const withClient = (client) => client || defaultClient;

function mustBeConfigured(client) {
  const c = withClient(client);
  if (!c) throw new Error('Supabase não configurado (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)');
  return c;
}

function requireCompanyId(companyId) {
  if (!companyId) throw new Error('Empresa atual não definida');
  return companyId;
}

// ---------- Mapeamento ----------

export function fromSupabaseCategory(row) {
  if (!row) return row;
  return {
    id: row.id,
    company_id: row.company_id,
    name: row.name,
    description: row.description,
    icon: row.icon,
    image_url: row.image_url,
    active: row.active,
    order: row.sort_order ?? 0,
  };
}

export function toSupabaseCategory(data) {
  return toSupabaseCategoryPatch({ name: '', active: true, ...data });
}

// Patch parcial: mapeia SOMENTE as chaves presentes (updates não tocam
// nos demais campos).
export function toSupabaseCategoryPatch(data) {
  const out = {};
  if (data.name !== undefined) out.name = data.name;
  if (data.description !== undefined) out.description = data.description ?? null;
  if (data.icon !== undefined) out.icon = data.icon || null;
  if (data.image_url !== undefined) out.image_url = data.image_url || null;
  if (data.active !== undefined) out.active = data.active ?? true;
  if (data.order !== undefined) out.sort_order = Number(data.order) || 0;
  if (data.sort_order !== undefined) out.sort_order = Number(data.sort_order) || 0;
  return out;
}

export function fromSupabaseProduct(row) {
  if (!row) return row;
  return {
    id: row.id,
    company_id: row.company_id,
    category_id: row.category_id,
    name: row.name,
    description: row.description,
    image_url: row.image_url,
    price: row.price != null ? Number(row.price) : row.price,
    promotional_price: row.promotional_price != null ? Number(row.promotional_price) : null,
    sku: row.sku,
    internal_code: row.internal_code,
    available: row.active ?? true,
    is_featured: !!row.is_featured,
    is_bestseller: !!row.is_bestseller,
    is_made_to_order: !!row.is_made_to_order,
    out_of_stock: !!row.out_of_stock,
    stock: row.stock ?? -1,
    preparation_time: row.preparation_time ?? 15,
    sort_order: row.sort_order ?? 0,
    ingredients: row.ingredients,
    nutritional_info: row.nutritional_info,
    complements: Array.isArray(row.options) ? row.options : [],
  };
}

export function toSupabaseProduct(companyId, data) {
  return {
    ...toSupabaseProductPatch({ price: 0, available: true, ...data }),
    company_id: requireCompanyId(companyId),
  };
}

// Patch parcial: mapeia SOMENTE as chaves presentes.
export function toSupabaseProductPatch(data) {
  const out = {};
  if (data.category_id !== undefined) out.category_id = data.category_id || null;
  if (data.name !== undefined) out.name = data.name;
  if (data.description !== undefined) out.description = data.description ?? null;
  if (data.image_url !== undefined) out.image_url = data.image_url || null;
  if (data.price !== undefined) out.price = Number(data.price) || 0;
  if (data.promotional_price !== undefined) {
    out.promotional_price = data.promotional_price === '' || data.promotional_price == null
      ? null
      : Number(data.promotional_price);
  }
  if (data.sku !== undefined) out.sku = data.sku || null;
  if (data.internal_code !== undefined) out.internal_code = data.internal_code || null;
  if (data.available !== undefined) out.active = data.available;
  else if (data.active !== undefined) out.active = data.active;
  for (const flag of ['is_featured', 'is_bestseller', 'is_made_to_order', 'out_of_stock']) {
    if (data[flag] !== undefined) out[flag] = !!data[flag];
  }
  if (data.stock !== undefined) out.stock = data.stock === '' ? -1 : Number(data.stock);
  if (data.preparation_time !== undefined) {
    out.preparation_time = data.preparation_time === '' ? 15 : Number(data.preparation_time);
  }
  if (data.sort_order !== undefined) out.sort_order = data.sort_order === '' ? 0 : Number(data.sort_order);
  if (data.ingredients !== undefined) out.ingredients = data.ingredients || null;
  if (data.nutritional_info !== undefined) out.nutritional_info = data.nutritional_info || null;
  if (data.complements !== undefined) out.options = Array.isArray(data.complements) ? data.complements : [];
  else if (data.options !== undefined) out.options = Array.isArray(data.options) ? data.options : [];
  return out;
}

// Categoria deve existir e pertencer à mesma empresa (defesa em
// profundidade; o trigger no banco é a garantia primária).
export async function assertCategoryOfCompany(client, companyId, categoryId) {
  if (!categoryId) return;
  const c = mustBeConfigured(client);
  const { data, error } = await c.from('categories').select('id,company_id').eq('id', categoryId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Categoria não encontrada');
  if (data.company_id !== companyId) throw new Error('Categoria pertence a outra empresa');
}

// ---------- Categorias ----------

export async function listCategories(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('categories')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return (data || []).map(fromSupabaseCategory);
}

export async function createCategory(client, companyId, data) {
  const c = mustBeConfigured(client);
  if (!data?.name?.trim()) throw new Error('Nome é obrigatório');
  const { data: row, error } = await c
    .from('categories')
    .insert({ ...toSupabaseCategory(data), company_id: requireCompanyId(companyId) })
    .select()
    .single();
  if (error) throw error;
  return fromSupabaseCategory(row);
}

export async function updateCategory(client, id, data) {
  const c = mustBeConfigured(client);
  const { data: row, error } = await c.from('categories').update(toSupabaseCategoryPatch(data)).eq('id', id).select().single();
  if (error) throw error;
  return fromSupabaseCategory(row);
}

export async function deleteCategory(client, id) {
  const c = mustBeConfigured(client);
  const { error } = await c.from('categories').delete().eq('id', id);
  if (error) throw error;
}

// ---------- Produtos ----------

export async function listProducts(client, companyId) {
  const c = mustBeConfigured(client);
  const { data, error } = await c
    .from('products')
    .select('*')
    .eq('company_id', requireCompanyId(companyId))
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map(fromSupabaseProduct);
}

export async function createProduct(client, companyId, data) {
  const c = mustBeConfigured(client);
  if (!data?.name?.trim()) throw new Error('Nome é obrigatório');
  if (!data?.price || Number(data.price) <= 0) throw new Error('Preço é obrigatório');
  await assertCategoryOfCompany(c, requireCompanyId(companyId), data.category_id || null);
  const { data: row, error } = await c.from('products').insert(toSupabaseProduct(companyId, data)).select().single();
  if (error) throw error;
  return fromSupabaseProduct(row);
}

export async function updateProduct(client, id, data) {
  const c = mustBeConfigured(client);
  const payload = toSupabaseProductPatch(data); // sem company_id: imutável (trigger)
  if (data.category_id !== undefined) {
    // valida contra a empresa dona da linha (RLS garante visibilidade só da própria)
    const { data: current, error: curErr } = await c.from('products').select('company_id').eq('id', id).maybeSingle();
    if (curErr) throw curErr;
    if (!current) throw new Error('Produto não encontrado');
    await assertCategoryOfCompany(c, current.company_id, data.category_id || null);
  }
  const { data: row, error } = await c.from('products').update(payload).eq('id', id).select().single();
  if (error) throw error;
  return fromSupabaseProduct(row);
}

export async function deleteProduct(client, id) {
  const c = mustBeConfigured(client);
  const { error } = await c.from('products').delete().eq('id', id);
  if (error) throw error;
}
