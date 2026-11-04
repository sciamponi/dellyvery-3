import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')
  || Deno.env.get('SUPABASE_PUBLISHABLE_KEY')
  || '';
const APP_ORIGIN_RAW = (Deno.env.get('APP_ORIGIN') || '').trim();
const ENVIRONMENT = (Deno.env.get('ENVIRONMENT')
  || Deno.env.get('APP_ENV')
  || Deno.env.get('NODE_ENV')
  || '').trim().toLowerCase();
const IS_PRODUCTION = ENVIRONMENT === 'production' || ENVIRONMENT === 'prod';

function parseConfiguredOrigin(value: string): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (url.pathname !== '/' || url.search || url.hash) return '';
    return url.origin;
  } catch {
    return '';
  }
}

const APP_ORIGIN = parseConfiguredOrigin(APP_ORIGIN_RAW);

function isLocalOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return url.hostname === 'localhost'
      || url.hostname === '127.0.0.1'
      || url.hostname === '[::1]';
  } catch {
    return false;
  }
}

const CODE_RE = /^\d{6}$/;
const PROOF_TTL_SECONDS = 15 * 60;

type JsonRecord = Record<string, unknown>;

function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('origin') || '';
  const allowed = APP_ORIGIN || (!IS_PRODUCTION && isLocalOrigin(origin) ? origin : '');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (allowed) headers['Access-Control-Allow-Origin'] = allowed;
  return headers;
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

function bearerToken(req: Request): string {
  const header = req.headers.get('authorization') || '';
  return header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
}

function normalizedEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') {
    return json(req, { ok: false, code: 'method_not_allowed', error: 'Metodo nao permitido' }, 405);
  }

  if (IS_PRODUCTION && !APP_ORIGIN) {
    return json(req, {
      ok: false,
      code: 'server_config',
      error: 'APP_ORIGIN obrigatorio em producao',
    }, 500);
  }

  const origin = req.headers.get('origin') || '';
  if (origin) {
    if (APP_ORIGIN) {
      if (origin !== APP_ORIGIN) {
        return json(req, { ok: false, code: 'origin_not_allowed', error: 'Origem nao permitida' }, 403);
      }
    } else if (!isLocalOrigin(origin)) {
      return json(req, { ok: false, code: 'origin_not_allowed', error: 'Origem nao permitida' }, 403);
    }
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return json(req, { ok: false, code: 'server_config', error: 'Servico de verificacao nao configurado' }, 500);
  }

  const token = bearerToken(req);
  if (!token) {
    return json(req, { ok: false, code: 'unauthorized', error: 'Sessao ausente' }, 401);
  }

  let body: JsonRecord;
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'invalid_body', error: 'Corpo da requisicao invalido' }, 400);
  }

  const action = body?.action;
  const inviteToken = typeof body?.inviteToken === 'string' ? body.inviteToken.trim() : '';
  if (action !== 'request' && action !== 'verify') {
    return json(req, { ok: false, code: 'invalid_action', error: 'Acao invalida' }, 400);
  }
  if (!inviteToken || inviteToken.length > 256) {
    return json(req, { ok: false, code: 'invalid_invite', error: 'Convite invalido' }, 400);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  const user = authData?.user;
  if (authError || !user?.id) {
    return json(req, { ok: false, code: 'unauthorized', error: 'Sessao invalida ou expirada' }, 401);
  }

  const email = normalizedEmail(user.email);
  if (!email) {
    return json(req, { ok: false, code: 'email_missing', error: 'Sua conta nao possui e-mail' }, 422);
  }

  const { data: inviteData, error: inviteError } = await admin.rpc('resolve_reseller_client_invite', {
    p_token: inviteToken,
  });

  if (inviteError || !inviteData || typeof inviteData !== 'object') {
    return json(req, { ok: false, code: 'invite_not_found', error: 'Convite nao encontrado' }, 404);
  }

  const invite = inviteData as JsonRecord;
  const inviteId = String(invite.invite_id || '');
  const invitedEmail = normalizedEmail(invite.invited_email);
  const status = String(invite.status || '');
  const expiresAt = String(invite.expires_at || '');

  if (!inviteId || !invitedEmail) {
    return json(req, { ok: false, code: 'invite_not_found', error: 'Convite nao encontrado' }, 404);
  }
  if (status !== 'pending' || (expiresAt && Date.parse(expiresAt) <= Date.now())) {
    return json(req, { ok: false, code: 'invite_unavailable', error: 'Convite nao esta mais disponivel' }, 409);
  }
  if (invitedEmail !== email) {
    return json(req, {
      ok: false,
      code: 'email_mismatch',
      error: 'Entre com o e-mail que recebeu o convite para confirmar a posse',
    }, 403);
  }

  if (action === 'request') {
    const redirectTo = APP_ORIGIN
      ? `${APP_ORIGIN}/convite-cliente/${encodeURIComponent(inviteToken)}`
      : undefined;

    const { error: sendError } = await authClient.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        ...(redirectTo ? { emailRedirectTo: redirectTo } : {}),
      },
    });

    if (sendError) {
      const statusCode = Number((sendError as { status?: number }).status || 0);
      console.error('[reseller-invite-email-proof] send failed', { inviteId, code: sendError.code, status: statusCode });
      if (statusCode === 429) {
        return json(req, {
          ok: false,
          code: 'rate_limited',
          error: 'Aguarde alguns minutos antes de solicitar outro codigo',
        }, 429);
      }
      return json(req, {
        ok: false,
        code: 'send_failed',
        error: 'Nao foi possivel enviar o codigo para o e-mail do convite',
      }, 502);
    }

    return json(req, {
      ok: true,
      sent: true,
      email,
      expiresInSeconds: 3600,
    });
  }

  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!CODE_RE.test(code)) {
    return json(req, { ok: false, code: 'invalid_code', error: 'Informe o codigo de 6 digitos' }, 400);
  }

  const { data: verifyData, error: verifyError } = await authClient.auth.verifyOtp({
    email,
    token: code,
    type: 'email',
  });

  const verifiedUser = verifyData?.user;
  if (verifyError || !verifiedUser?.id || verifiedUser.id !== user.id || normalizedEmail(verifiedUser.email) !== email) {
    console.error('[reseller-invite-email-proof] verify failed', {
      inviteId,
      userId: user.id,
      code: verifyError?.code,
    });
    return json(req, {
      ok: false,
      code: 'invalid_or_expired_code',
      error: 'Codigo invalido ou expirado. Solicite um novo codigo.',
    }, 400);
  }

  const { data: proofData, error: proofError } = await admin.rpc('record_reseller_invite_email_proof', {
    p_invite_id: inviteId,
    p_user_id: user.id,
    p_email: email,
    p_ttl_seconds: PROOF_TTL_SECONDS,
  });

  if (proofError || !proofData || typeof proofData !== 'object') {
    console.error('[reseller-invite-email-proof] proof record failed', {
      inviteId,
      userId: user.id,
      code: proofError?.code,
    });
    return json(req, {
      ok: false,
      code: 'proof_failed',
      error: 'Nao foi possivel registrar a confirmacao do e-mail',
    }, 409);
  }

  const proof = proofData as JsonRecord;

  return json(req, {
    ok: true,
    verified: true,
    email,
    proofId: proof.proof_id || null,
    expiresAt: proof.expires_at || null,
  });
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (error) {
    console.error('[reseller-invite-email-proof] unhandled error', error);
    return json(req, {
      ok: false,
      code: 'server_error',
      error: 'Nao foi possivel processar a verificacao',
    }, 500);
  }
});
