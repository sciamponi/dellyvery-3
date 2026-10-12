import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FLYER_PRINT_CSS } from './printCss.js';

describe('printCss — flyer em uma folha A4', () => {
  it('regras de página única', () => {
    assert.ok(FLYER_PRINT_CSS.includes('@page'));
    assert.ok(/size:\s*A4\s+portrait/.test(FLYER_PRINT_CSS));
    assert.ok(FLYER_PRINT_CSS.includes('page-break-inside: avoid'));
    assert.ok(FLYER_PRINT_CSS.includes('break-inside: avoid'));
  });

  it('só o flyer imprime; resto some', () => {
    assert.ok(FLYER_PRINT_CSS.includes('.fly-print'));
    assert.ok(FLYER_PRINT_CSS.includes('body *') && FLYER_PRINT_CSS.includes('visibility: hidden'));
    assert.ok(FLYER_PRINT_CSS.includes('.no-print'));
  });

  it('dimensões A4 sem escala manual', () => {
    assert.ok(FLYER_PRINT_CSS.includes('210mm'));
    assert.ok(FLYER_PRINT_CSS.includes('297mm'));
    assert.ok(FLYER_PRINT_CSS.includes('.fly-print-img'));
    assert.ok(FLYER_PRINT_CSS.includes('max-height: 265mm'));
    assert.ok(FLYER_PRINT_CSS.includes('object-fit: contain'));
  });
});
