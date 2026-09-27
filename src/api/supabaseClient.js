import { createClient } from '@supabase/supabase-js';

// DELLVERY 3 — Camada central Supabase (FASE 5.1)
// Usa SOMENTE a anon/publishable key no frontend. Nunca service_role aqui.
// Guarda para rodar também fora do Vite (ex.: testes node:test).
const viteEnv = (import.meta && import.meta.env) || {};
const supabaseUrl = viteEnv.VITE_SUPABASE_URL;
// Correção onboarding: aceita a publishable key no nome exigido pelo ambiente,
// mantendo VITE_SUPABASE_ANON_KEY como alternativa. Nunca service_role aqui.
const supabaseAnonKey = viteEnv.VITE_SUPABASE_PUBLISHABLE_KEY || viteEnv.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = () => Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured() && viteEnv.DEV) {
  // eslint-disable-next-line no-console
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY ausentes — camada Supabase inativa, Base44 continua.');
}

export const supabase = isSupabaseConfigured()
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'dellyvery3-supabase-auth',
      },
    })
  : null;
