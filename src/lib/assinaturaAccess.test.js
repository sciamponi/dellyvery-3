import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadManagedResellerAccess } from './assinaturaAccess.js';

describe('assinaturaAccess', () => {
  it('executa a consulta de acesso gerenciado no client informado', async () => {
    const calls = [];
    const client = {
      rpc: async (name) => {
        calls.push(name);
        return { data: { status: 'active', company_name: 'Empresa Teste' }, error: null };
      },
    };

    const access = await loadManagedResellerAccess(client);

    assert.deepEqual(access, { status: 'active', company_name: 'Empresa Teste' });
    assert.deepEqual(calls, ['get_my_reseller_client_access']);
  });

  it('mantem a pagina ligada ao loader importado', () => {
    const source = readFileSync(new URL('../pages/Assinatura.jsx', import.meta.url), 'utf8');
    assert.match(source, /import \{ loadManagedResellerAccess \} from '@\/lib\/assinaturaAccess';/);
    assert.match(source, /loadManagedResellerAccess\(supabase\)/);
    assert.doesNotMatch(source, /\bgetMyResellerClientAccess\s*\(/);
  });
});
