import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const APP_ORIGIN = (Deno.env.get('APP_ORIGIN') || '').replace(/\/+$/, '');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type JsonRecord = Record<string, unknown>;

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('origin') || '';
  const allowed = APP_ORIGIN || origin || '*';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(req: Request, body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function publicMessage(value: unknown, fallback: string): string {
  const message = typeof value === 'string' ? value.trim() : '';
  return message && message.length <= 300 ? message : fallback;
}

function bearerToken(req: Request): string {
  const header = req.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

function requestOrigin(req: Request): string {
  const origin = (req.headers.get('origin') || '').replace(/\/+$/, '');
  if (APP_ORIGIN) return APP_ORIGIN;
  return origin;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return json(req, { ok: false, code: 'method_not_allowed', error: 'Metodo nao permitido' }, 405);
  }

  const origin = req.headers.get('origin') || '';
  if (APP_ORIGIN && origin && origin.replace(/\/+$/, '') !== APP_ORIGIN) {
    return json(req, { ok: false, code: 'origin_not_allowed', error: 'Origem nao permitida' }, 403);
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json(req, { ok: false, code: 'server_config', error: 'Servico de aprovacao nao configurado' }, 500);
  }

  const appOrigin = requestOrigin(req);
  if (!appOrigin) {
    return json(req, { ok: false, code: 'server_config', error: 'Origem do aplicativo nao configurada' }, 500);
  }

  const token = bearerToken(req);
  if (!token) {
    return json(req, { ok: false, code: 'unauthorized', error: 'Sessao ausente' }, 401);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const actorId = authData?.user?.id;
  if (authError || !actorId) {
    return json(req, { ok: false, code: 'unauthorized', error: 'Sessao invalida ou expirada' }, 401);
  }

  const { data: actorProfile, error: actorError } = await admin
    .from('profiles')
    .select('id, platform_role')
    .eq('id', actorId)
    .maybeSingle();

  if (actorError) {
    console.error('[reseller-approve] actor lookup failed', { code: actorError.code });
    return json(req, { ok: false, code: 'server_error', error: 'Nao foi possivel validar a permissao' }, 500);
  }
  if (actorProfile?.platform_role !== 'PLATFORM_ADMIN') {
    return json(req, { ok: false, code: 'forbidden', error: 'Acesso restrito ao administrador master' }, 403);
  }

  let body: JsonRecord;
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'invalid_body', error: 'Corpo da requisicao invalido' }, 400);
  }

  const inviteId = typeof body?.inviteId === 'string' ? body.inviteId.trim() : '';
  if (!UUID_RE.test(inviteId)) {
    return json(req, { ok: false, code: 'invalid_invite', error: 'Convite invalido' }, 400);
  }

  const { data: invite, error: inviteError } = await admin
    .from('reseller_invites')
    .select('id, name, phone, status, registration')
    .eq('id', inviteId)
    .maybeSingle();

  if (inviteError) {
    console.error('[reseller-approve] invite lookup failed', { inviteId, code: inviteError.code });
    return json(req, { ok: false, code: 'server_error', error: 'Nao foi possivel carregar o convite' }, 500);
  }
  if (!invite) {
    return json(req, { ok: false, code: 'not_found', error: 'Convite nao encontrado' }, 404);
  }
  if (invite.status !== 'aguardando_aprovacao' && invite.status !== 'aprovado') {
    const message = invite.status === 'suspenso'
      ? 'Acesso suspenso. Reative o revendedor antes de gerar um novo link.'
      : 'Este convite nao esta aguardando aprovacao';
    return json(req, { ok: false, code: 'invite_status', error: message }, 409);
  }

  const { data: existingReseller, error: resellerError } = await admin
    .from('resellers')
    .select('id, user_id, status')
    .eq('invite_id', inviteId)
    .maybeSingle();

  if (resellerError) {
    console.error('[reseller-approve] reseller lookup failed', { inviteId, code: resellerError.code });
    return json(req, { ok: false, code: 'server_error', error: 'Nao foi possivel verificar o acesso' }, 500);
  }
  if (existingReseller && existingReseller.status !== 'ativo') {
    return json(req, {
      ok: false,
      code: 'reseller_suspended',
      error: 'Acesso do revendedor nao esta ativo. Reative antes de gerar um novo link.',
    }, 409);
  }

  const registration = (invite.registration && typeof invite.registration === 'object')
    ? invite.registration as JsonRecord
    : {};
  const email = String(registration.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json(req, {
      ok: false,
      code: 'email_missing',
      error: 'Informe o e-mail do revendedor antes de aprovar',
    }, 422);
  }

  // Se o convite ja tem vinculo, o e-mail de acesso e o da conta vinculada.
  // Bloquear aqui evita criar uma conta Auth orfa ao tentar "aprovar" com
  // outro e-mail (a RPC recusaria o vinculo depois da criacao).
  if (existingReseller?.user_id) {
    const { data: boundData, error: boundError } = await admin.auth.admin.getUserById(existingReseller.user_id);
    const boundEmail = String(boundData?.user?.email || '').trim().toLowerCase();
    if (boundError || !boundEmail) {
      console.error('[reseller-approve] bound user lookup failed', { inviteId, code: boundError?.code });
      return json(req, { ok: false, code: 'server_error', error: 'Nao foi possivel verificar a conta vinculada' }, 500);
    }
    if (boundEmail !== email) {
      return json(req, {
        ok: false,
        code: 'email_mismatch',
        error: 'Este acesso ja esta vinculado a outro e-mail. Gere o link para o e-mail cadastrado.',
      }, 409);
    }
  }

  const { data: lookup, error: lookupError } = await admin.rpc('reseller_lookup_auth_user', {
    p_email: email,
  });

  if (lookupError) {
    console.error('[reseller-approve] auth lookup failed', { inviteId, code: lookupError.code });
    return json(req, { ok: false, code: 'server_error', error: 'Nao foi possivel verificar o e-mail' }, 500);
  }

  let userId = '';
  let accessMode: 'invite' | 'reuse' = 'reuse';

  if (lookup && typeof lookup === 'object') {
    const foundUserId = String((lookup as JsonRecord).user_id || '');
    const confirmed = (lookup as JsonRecord).email_confirmed === true;
    if (!confirmed) {
      return json(req, {
        ok: false,
        code: 'email_unconfirmed',
        error: 'Este e-mail ja possui uma conta nao confirmada. Peça ao revendedor para confirmar ou usar outro e-mail.',
      }, 409);
    }
    userId = foundUserId;
  } else {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: {
        reseller_invite_id: invite.id,
        full_name: invite.name,
        phone: invite.phone,
      },
    });

    if (createError || !created?.user?.id) {
      // Corrida: outra execucao pode ter criado o usuario entre o lookup e o create.
      const { data: retryLookup } = await admin.rpc('reseller_lookup_auth_user', { p_email: email });
      if (retryLookup && typeof retryLookup === 'object' && (retryLookup as JsonRecord).email_confirmed === true) {
        userId = String((retryLookup as JsonRecord).user_id || '');
        accessMode = 'reuse';
      } else {
        console.error('[reseller-approve] auth create failed', { inviteId, code: createError?.code });
        return json(req, { ok: false, code: 'auth_create_failed', error: 'Nao foi possivel criar o acesso' }, 500);
      }
    } else {
      userId = created.user.id;
      accessMode = 'invite';
    }
  }

  if (!userId) {
    return json(req, { ok: false, code: 'auth_create_failed', error: 'Nao foi possivel identificar o usuario de acesso' }, 500);
  }

  const redirectTo = `${appOrigin}/reset-password?next=${encodeURIComponent('/revenda')}`;
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo },
  });

  const actionLink = (linkData as { properties?: { action_link?: string } } | null)?.properties?.action_link || '';
  if (linkError || !actionLink) {
    console.error('[reseller-approve] link generation failed', { inviteId, code: linkError?.code });
    return json(req, { ok: false, code: 'link_failed', error: 'Nao foi possivel gerar o link de acesso' }, 500);
  }

  const { data: approved, error: approveError } = await admin.rpc('approve_reseller_access', {
    p_invite_id: inviteId,
    p_user_id: userId,
    p_actor: actorId,
  });

  if (approveError) {
    console.error('[reseller-approve] approval rpc failed', { inviteId, code: approveError.code });
    return json(req, {
      ok: false,
      code: 'approval_failed',
      error: publicMessage(approveError.message, 'Nao foi possivel concluir a aprovacao'),
    }, 409);
  }

  const result = (approved && typeof approved === 'object') ? approved as JsonRecord : {};

  return json(req, {
    ok: true,
    resellerId: result.reseller_id || existingReseller?.id || null,
    userId,
    status: result.status || 'ativo',
    reused: result.reused === true || accessMode === 'reuse' || Boolean(existingReseller),
    email,
    accessLink: actionLink,
    redirectTo,
  });
});
