import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateUploadFile,
  buildUploadPath,
  uploadImage,
  deleteImage,
  getPixQrPublicUrl,
  MAX_UPLOAD_BYTES,
  PLATFORM_ASSETS_BUCKET,
  PIX_QR_FOLDER,
} from './storage.js';

const jpg = (size = 100) => ({ type: 'image/jpeg', size });

function createMockClient({
  uploadResult = { data: { path: 'x' }, error: null },
  publicUrl = 'http://cdn/x',
  removeResult = { data: null, error: null },
} = {}) {
  const calls = [];
  const removals = [];
  return {
    calls,
    removals,
    storage: {
      from: (bucket) => ({
        upload: async (path, file, opts) => {
          calls.push({ bucket, path, size: file.size, contentType: opts?.contentType });
          return uploadResult;
        },
        getPublicUrl: (path) => ({ data: { publicUrl: `${publicUrl}/${path}` } }),
        remove: async (paths) => {
          removals.push({ bucket, paths });
          return removeResult;
        },
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
    assert.deepEqual(buildUploadPath('pix_qr', PIX_QR_FOLDER, jpg(), 'f'), {
      bucket: PLATFORM_ASSETS_BUCKET,
      path: 'pix-qr/f.jpg',
    });
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

  it('sobe QR global em pasta imprevisível e remove pelo caminho', async () => {
    const client = createMockClient();
    const out = await uploadImage(client, 'pix_qr', PIX_QR_FOLDER, { type: 'image/png', size: 100 });
    assert.equal(out.bucket, PLATFORM_ASSETS_BUCKET);
    assert.match(out.path, /^pix-qr\/.+\.png$/);
    assert.equal(client.calls[0].bucket, PLATFORM_ASSETS_BUCKET);

    assert.equal(await deleteImage(client, PLATFORM_ASSETS_BUCKET, out.path), true);
    assert.deepEqual(client.removals[0], { bucket: PLATFORM_ASSETS_BUCKET, paths: [out.path] });
    assert.equal(await deleteImage(client, null, null), false);
  });

  it('resolve URL publica do QR somente a partir de pix-qr', () => {
    const client = createMockClient({ publicUrl: 'https://cdn/platform-assets' });
    assert.equal(
      getPixQrPublicUrl(client, 'pix-qr/a.png'),
      'https://cdn/platform-assets/pix-qr/a.png',
    );
    assert.equal(getPixQrPublicUrl(client, 'pix-qr/a.png?x=1'), 'https://cdn/platform-assets/pix-qr/a.png?x=1');
    assert.equal(getPixQrPublicUrl(client, 'outros/a.png'), '');
    assert.equal(getPixQrPublicUrl(client, ''), '');
    assert.equal(getPixQrPublicUrl(null, 'pix-qr/a.png'), '');
  });

  it('erro ao remover imagem propaga', async () => {
    const client = createMockClient({ removeResult: { data: null, error: new Error('falhou') } });
    await assert.rejects(
      () => deleteImage(client, PLATFORM_ASSETS_BUCKET, 'pix-qr/a.png'),
      /falhou/,
    );
  });
});
