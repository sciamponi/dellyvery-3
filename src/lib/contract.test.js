import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  adhesionStatusLabel, fmtBRL, fmtDateBR, onlyDigits,
  validateAdhesion, missingContractFields,
  buildContractModel, buildContractShareText,
} from './contract.js';

describe('contract — validação de salvamento', () => {
  it('rascunho incompleto passa; valores inválidos barram', () => {
    assert.equal(validateAdhesion({ status: 'rascunho' }), null);
    assert.equal(validateAdhesion({ status: 'xx' }), 'Situação inválida');
    assert.match(validateAdhesion({ monthly_fee: -5 }), /zero/);
    assert.match(validateAdhesion({ adhesion_fee: 'abc' }), /zero/);
    assert.match(validateAdhesion({ due_day: 31 }), /1 a 28/);
    assert.match(validateAdhesion({ due_day: 0 }), /1 a 28/);
    assert.equal(validateAdhesion({ due_day: 10, payment_method: 'Pix', start_date: '2026-11-01' }), null);
    assert.match(validateAdhesion({ payment_method: 'Fiado' }), /pagamento/);
    assert.match(validateAdhesion({ start_date: 'xx' }), /início/);
  });
});

describe('contract — pendências de emissão', () => {
  it('lista tudo que falta; vazio quando pronto', () => {
    const missing = missingContractFields({ status: 'rascunho' });
    assert.ok(missing.includes('Nome da contratante'));
    assert.ok(missing.includes('Plano contratado'));
    assert.ok(missing.includes('Razão social da fornecedora'));
    const ready = missingContractFields({
      full_name: 'Joice', document: '123', phone: '119', plan_id: 'p1',
      start_date: '2026-11-01', payment_method: 'Pix',
      provider: { razao_social: 'Dellyvery', document: '00', address: 'Rua X' },
    });
    assert.deepEqual(ready, []);
  });
});

describe('contract — modelo e compartilhamento (sem inventar dados)', () => {
  const adhesion = {
    full_name: 'Joice', trade_name: '', person_type: 'pf', document: '111',
    phone: '119', email: '', address: { street: 'Rua A', number: '10', city: 'SP' },
    plan_id: 'p1', plan_name: 'Completo', adhesion_fee: 100, monthly_fee: 49.9,
    discount_text: '', start_date: '2026-11-01', due_day: 10, payment_method: 'Pix',
    status: 'ativa', provider: { razao_social: 'Dellyvery LTDA', document: '00', address: 'Rua B' },
  };
  it('modelo congela valores da adesão + plano', () => {
    const m = buildContractModel(adhesion, { name: 'Outro', features: ['F1'], benefits: ['B1'] });
    assert.equal(m.contractor.name, 'Joice');
    assert.equal(m.plan.name, 'Completo');
    assert.deepEqual(m.plan.features, ['F1']);
    assert.equal(m.commercial.adhesionFee, 100);
    assert.equal(m.commercial.monthlyFee, 49.9);
    assert.equal(m.commercial.status, 'Ativa');
    assert.ok(m.issuedAt);
  });

  it('texto WhatsApp resume sem afirmar envio', () => {
    const t = buildContractShareText(buildContractModel(adhesion, null));
    assert.ok(t.includes('Joice'));
    assert.ok(t.includes('R$\u00a0100,00'));
    assert.ok(t.includes('R$\u00a049,90'));
    assert.ok(!/foi enviado|foi assinado|pagamento recebido|pagamento confirmado|assinatura eletr|validade/i.test(t));
  });

  it('helpers de formato', () => {
    assert.equal(fmtBRL(49.9), 'R$\u00a049,90');
    assert.equal(fmtDateBR('2026-11-01'), '01/11/2026');
    assert.equal(fmtDateBR(''), '—');
    assert.equal(onlyDigits('(11) 90000-0001'), '11900000001');
  });
});
