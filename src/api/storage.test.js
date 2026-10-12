import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUploadFile,
  buildUploadPath,
  uploadImage,
  MAX_UPLOAD_BYTES,
} from './storage.js';

const jpg = (size = 100) => ({ type: 'image/jpeg', size });

function createMockClient({ uploadResult = { data: { path: 'x' }, error: null }, publicUrl = 'http://cdn/x' } = {}) {
  const calls = [];
  return {
    calls,
    storage: {
      from: (bucket) => ({
        upload: async (path, file, opts) => {
          calls.push({ bucket, path, size: file.size, contentType: opts?.contentType });
          return uploadResult;
        },
        getPublicUrl: (path) => ({ data: { publicUrl: `${publicUrl}/${path}` } }),
      }),
    },
  };
}

describe('storage — validação', () => {
  it('limite 5MB e MIME', () => {
    validateUploadFile(jpg(100));
    assert.throws(() => validateUploadFile({ type: 'image/gif', size: 100 }), /Formato inválido/);
    assert.throws(() => validateUploadFile(jpg(MAX_UPLOAD_BYTES + 1)), /5MB/);
    assert.throws(() => validateUploadFile(null), /não informado/);
  });

  it('paths por dono: avatar=user, demais=company', () => {
    assert.deepEqual(buildUploadPath('avatar', 'u1', jpg(), 'a').path, 'u1/a.jpg');
    assert.deepEqual(buildUploadPath('logo', 'c1', { type: 'image/png', size: 1 }, 'b'), { bucket: 'logos', path: 'c1/b.png' });
    assert.deepEqual(buildUploadPath('catalog', 'c1', { type: 'image/webp', size: 1 }, 'd').bucket, 'catalog');
    assert.deepEqual(buildUploadPath('cover', 'c1', jpg(), 'e'), { bucket: 'logos', path: 'c1/e.jpg' });
    assert.throws(() => buildUploadPath('x', 'c1', jpg()), /inválido/);
    assert.throws(() => buildUploadPath('logo', null, jpg()), /Dono/);
  });
});

describe('storage — upload', () => {
  it('sobe com contentType e retorna URL pública', async () => {
    const client = createMockClient();
    const out = await uploadImage(client, 'catalog', 'c1', jpg(100));
    assert.ok(out.file_url.startsWith('http://cdn/x/c1/'));
    assert.equal(client.calls[0].bucket, 'catalog');
    assert.equal(client.calls[0].contentType, 'image/jpeg');
  });

  it('erro do storage propaga', async () => {
    const client = createMockClient({ uploadResult: { data: null, error: new Error('bloqueado') } });
    await assert.rejects(() => uploadImage(client, 'logo', 'c1', jpg(10)), /bloqueado/);
  });

  it('sem configuração falha antes da rede', async () => {
    await assert.rejects(() => uploadImage(null, 'logo', 'c1', jpg(10)), /não configurado/);
  });
});
