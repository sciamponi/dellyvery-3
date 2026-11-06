import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const APP_ORIGIN = process.env.APP_ORIGIN || 'http://localhost:5174';
const MAILPIT_URL = process.env.MAILPIT_URL || 'http://127.0.0.1:54324';
const FUNCTION_URL = process.env.EDGE_FUNCTION_URL
  || `${SUPABASE_URL}/functions/v1/reseller-invite-email-proof`;

assert.ok(ANON_KEY, 'SUPABASE_ANON_KEY is required');
assert.ok(SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY is required');

const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
const password = `Proof-${crypto.randomBytes(12).toString('hex')}!`;
const resellerEmail = `proof-reseller-${runId}@example.com`;
const clientEmail = `proof-client-${runId}@example.com`;
const otherEmail = `proof-other-${runId}@example.com`;

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(SUPABASE_URL, ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function invokeProof(body, jwt, origin = APP_ORIGIN) {
  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      Authorization: `Bearer ${jwt}`,
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

async function mailpitJson(path) {
  const response = await fetch(`${MAILPIT_URL}${path}`);
  if (!response.ok) throw new Error(`Mailpit ${path} returned ${response.status}`);
  return response.json();
}

async function waitForCode(email) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    const list = await mailpitJson('/api/v1/messages?limit=100');
    const message = (list.messages || [])
      .filter((item) => (item.To || []).some((to) => to.Address === email))
      .sort((a, b) => String(b.Created).localeCompare(String(a.Created)))[0];
    if (message) {
      const detail = await mailpitJson(`/api/v1/message/${message.ID}`);
      const text = `${detail.Text || ''}\n${detail.HTML || ''}`;
      const code = text.match(/\b(\d{8})\b/)?.[1];
      if (code) return { code, detail };
    }
    await sleep(400);
  }
  throw new Error(`No OTP email found for ${email}`);
}

async function cleanup() {
  try {
    await admin.from('reseller_client_invites').delete().eq('invited_email', clientEmail);
    await admin.from('reseller_clients').delete().eq('email', clientEmail);
    await admin.from('resellers').delete().eq('user_id', resellerUser?.id || '00000000-0000-0000-0000-000000000000');
    await admin.from('reseller_invites').delete().eq('token', resellerInviteToken);
    for (const email of [clientEmail, resellerEmail, otherEmail]) {
      const { data } = await admin.auth.admin.listUsers();
      const user = (data?.users || []).find((item) => item.email === email);
      if (user) await admin.auth.admin.deleteUser(user.id);
    }
  } catch (error) {
    console.error('cleanup warning:', error.message);
  }
}

let resellerUser = null;
let resellerInviteToken = '';

try {
  const { data: createdReseller, error: resellerError } = await admin.auth.admin.createUser({
    email: resellerEmail,
    password,
    email_confirm: true,
  });
  assert.ifError(resellerError);
  resellerUser = createdReseller.user;

  await admin.from('profiles').upsert({
    id: resellerUser.id,
    email: resellerEmail,
    name: 'Proof Reseller',
    platform_role: 'USER',
  });

  resellerInviteToken = crypto.randomBytes(24).toString('hex');
  const { data: resellerInvite, error: inviteError } = await admin
    .from('reseller_invites')
    .insert({
      token: resellerInviteToken,
      name: 'Proof Reseller',
      phone: `5511${Date.now().toString().slice(-9)}`,
      status: 'aprovado',
      registration: { email: resellerEmail },
      decided_at: new Date().toISOString(),
    })
    .select()
    .single();
  assert.ifError(inviteError);

  const { data: reseller, error: resellerRowError } = await admin
    .from('resellers')
    .insert({
      user_id: resellerUser.id,
      invite_id: resellerInvite.id,
      status: 'ativo',
    })
    .select()
    .single();
  assert.ifError(resellerRowError);

  const { data: signUp, error: signUpError } = await anon.auth.signUp({
    email: clientEmail,
    password,
  });
  assert.ifError(signUpError);
  assert.ok(signUp.session?.access_token, 'signup must return a real local session');
  const clientJwt = signUp.session.access_token;
  const clientId = signUp.user.id;
  assert.equal(signUp.user.email, clientEmail);

  const { data: client, error: clientError } = await admin
    .from('reseller_clients')
    .insert({
      reseller_id: reseller.id,
      name: 'Proof Client',
      trade_name: 'Proof Client',
      email: clientEmail,
      status: 'prospecto',
    })
    .select()
    .single();
  assert.ifError(clientError);

  const inviteToken = crypto.randomBytes(24).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(inviteToken).digest('hex');
  const { data: clientInvite, error: clientInviteError } = await admin
    .from('reseller_client_invites')
    .insert({
      reseller_id: reseller.id,
      client_id: client.id,
      token_hash: tokenHash,
      invited_email: clientEmail,
      expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    })
    .select()
    .single();
  assert.ifError(clientInviteError);

  const { error: withoutProofError } = await anon.rpc('claim_reseller_client_invite', {
    p_token: inviteToken,
  });
  assert.ok(withoutProofError, 'claim without proof must fail');
  assert.match(withoutProofError.message, /posse do e-mail/i);
  console.log('PASS real signup JWT without proof is rejected');

  const { data: otherUser, error: otherError } = await admin.auth.admin.createUser({
    email: otherEmail,
    password,
    email_confirm: true,
  });
  assert.ifError(otherError);
  const otherClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: otherSession, error: otherLoginError } = await otherClient.auth.signInWithPassword({
    email: otherEmail,
    password,
  });
  assert.ifError(otherLoginError);

  const otherRequest = await invokeProof(
    { action: 'request', inviteToken },
    otherSession.session.access_token,
  );
  assert.equal(otherRequest.status, 403, JSON.stringify(otherRequest.payload));
  assert.equal(otherRequest.payload?.code, 'email_mismatch');
  console.log('PASS another authenticated user cannot request proof');

  for (const invalidCode of ['123456', '1234567', '123456789']) {
    const invalidLength = await invokeProof(
      { action: 'verify', inviteToken, code: invalidCode },
      clientJwt,
    );
    assert.equal(invalidLength.status, 400, JSON.stringify(invalidLength.payload));
    assert.equal(invalidLength.payload?.code, 'invalid_code');
  }
  console.log('PASS OTP length is exactly 8 digits');

  const requestResult = await invokeProof({ action: 'request', inviteToken }, clientJwt);
  assert.equal(requestResult.status, 200, JSON.stringify(requestResult.payload));
  assert.equal(requestResult.payload?.ok, true);

  const { code } = await waitForCode(clientEmail);
  assert.equal(code.length, 8);
  console.log('PASS 8-digit OTP email delivered to invited address');

  const otherVerify = await invokeProof(
    { action: 'verify', inviteToken, code },
    otherSession.session.access_token,
  );
  assert.equal(otherVerify.status, 403, JSON.stringify(otherVerify.payload));
  assert.equal(otherVerify.payload?.code, 'email_mismatch');
  console.log('PASS another authenticated user cannot verify the OTP');

  const wrongCode = code === '00000000' ? '00000001' : '00000000';
  const wrongVerify = await invokeProof(
    { action: 'verify', inviteToken, code: wrongCode },
    clientJwt,
  );
  assert.equal(wrongVerify.status, 400, JSON.stringify(wrongVerify.payload));
  assert.equal(wrongVerify.payload?.code, 'invalid_or_expired_code');
  console.log('PASS wrong 8-digit OTP rejected');

  const verifyResult = await invokeProof({ action: 'verify', inviteToken, code }, clientJwt);
  assert.equal(verifyResult.status, 200, JSON.stringify(verifyResult.payload));
  assert.equal(verifyResult.payload?.ok, true);

  const { data: proof, error: proofError } = await admin
    .from('reseller_invite_email_proofs')
    .select('*')
    .eq('invite_id', clientInvite.id)
    .single();
  assert.ifError(proofError);
  assert.equal(proof.user_id, clientId);
  assert.equal(proof.email, clientEmail);
  assert.equal(proof.consumed_at, null);
  assert.ok(new Date(proof.expires_at).getTime() > Date.now());
  console.log('PASS server recorded proof bound to invite/user/email');

  const replay = await invokeProof({ action: 'verify', inviteToken, code }, clientJwt);
  assert.equal(replay.status, 400, JSON.stringify(replay.payload));
  console.log('PASS email OTP cannot be replayed');

  const changedEmail = `changed-${clientEmail}`;
  const { error: emailChangeError } = await admin.auth.admin.updateUserById(clientId, {
    email: changedEmail,
    email_confirm: true,
  });
  assert.ifError(emailChangeError);

  const { error: changedEmailClaimError } = await anon.rpc('claim_reseller_client_invite', {
    p_token: inviteToken,
  });
  assert.ok(changedEmailClaimError, 'email change after proof must block the claim');
  assert.match(changedEmailClaimError.message, /e-mail que recebeu o convite/i);
  console.log('PASS email change after proof blocks acceptance');

  const { error: emailRestoreError } = await admin.auth.admin.updateUserById(clientId, {
    email: clientEmail,
    email_confirm: true,
  });
  assert.ifError(emailRestoreError);

  const { data: claimed, error: claimError } = await anon.rpc('claim_reseller_client_invite', {
    p_token: inviteToken,
  });
  assert.ifError(claimError);
  assert.equal(claimed.status, 'accepted');
  assert.equal(claimed.reused, false);

  const { data: consumedProof } = await admin
    .from('reseller_invite_email_proofs')
    .select('consumed_at')
    .eq('id', proof.id)
    .single();
  assert.ok(consumedProof.consumed_at, 'proof must be consumed by claim');

  const { data: linkedClient } = await admin
    .from('reseller_clients')
    .select('user_id')
    .eq('id', client.id)
    .single();
  assert.equal(linkedClient.user_id, clientId);
  console.log('PASS valid proof is single-use and links only after acceptance');

  const { error: acceptedProofError } = await admin.rpc('record_reseller_invite_email_proof', {
    p_invite_id: clientInvite.id,
    p_user_id: clientId,
    p_email: clientEmail,
    p_ttl_seconds: 900,
  });
  assert.ok(acceptedProofError, 'accepted invite must not accept a new proof');
  assert.match(acceptedProofError.message, /nao esta mais disponivel/i);

  const { error: directTableError } = await anon
    .from('reseller_invite_email_proofs')
    .select('*')
    .limit(1);
  assert.ok(directTableError, 'authenticated client must not read proof table');
  console.log('PASS proof table is backend-only');

  console.log('ALL PASS: real JWT, real OTP delivery, backend proof, replay and access checks');
} finally {
  await cleanup();
}
