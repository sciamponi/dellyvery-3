import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  adhesionStatusLabel, fmtBRL, fmtDateBR, onlyDigits,
  validateAdhesion, missingContractFields,
  buildContractModel, buildContractShareText,
  normalizeAddress, mergeAddress, formatAddressLine,
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
    assert.match(fmtBRL(49.9), /R\$/);
    assert.ok(fmtBRL(49.9).includes('49,90'));
    assert.equal(fmtDateBR('2026-11-01'), '01/11/2026');
    assert.equal(fmtDateBR(''), '—');
    assert.equal(onlyDigits('(11) 90000-0001'), '11900000001');
  });
});

describe('contract — endereço: importação do lead sem perda', () => {
  const leadAddress = {
    street: 'Rua A', number: '10', complement: 'Sala 2', neighborhood: 'Centro',
    city: 'São Paulo', state: 'SP', zip_code: '01000000',
  };

  it('normalizeAddress preserva objeto completo do lead', () => {
    const n = normalizeAddress(leadAddress);
    assert.equal(n.street, 'Rua A');
    assert.equal(n.number, '10');
    assert.equal(n.complement, 'Sala 2');
    assert.equal(n.neighborhood, 'Centro');
    assert.equal(n.city, 'São Paulo');
    assert.equal(n.state, 'SP');
    assert.equal(n.zip_code, '01000000');
    // Espelho legado para adesões antigas que leem `zip`.
    assert.equal(n.zip, '01000000');
  });

  it('normalizeAddress aceita `zip` legado e aliases', () => {
    assert.equal(normalizeAddress({ street: 'R', zip: '123' }).zip_code, '123');
    assert.equal(normalizeAddress({ street: 'R', cep: '456' }).zip_code, '456');
    assert.equal(normalizeAddress({ logradouro: 'R X', bairro: 'B', uf: 'SP' }).street, 'R X');
    assert.equal(normalizeAddress({ logradouro: 'R X', bairro: 'B', uf: 'SP' }).neighborhood, 'B');
  });

  it('normalizeAddress trata string, JSON e vazio sem [object Object]', () => {
    assert.equal(normalizeAddress(null).street, '');
    assert.equal(normalizeAddress({}).street, '');
    assert.equal(normalizeAddress('Rua B, 20').street, 'Rua B, 20');
    const fromJson = normalizeAddress(JSON.stringify(leadAddress));
    assert.equal(fromJson.street, 'Rua A');
    assert.equal(fromJson.zip_code, '01000000');
    // Objetos aninhados nunca vazam para campos de texto.
    const weird = normalizeAddress({ street: { a: 1 }, city: 'SP' });
    assert.equal(typeof weird.street, 'string');
    assert.ok(!String(weird.street).includes('[object Object]'));
  });

  it('mergeAddress não sobrescreve digitado com vazio (pickLead/openEdit)', () => {
    // pickLead: digitado tem prioridade, lead preenche os vazios.
    const merged = mergeAddress(leadAddress, { street: 'Rua Digitada', city: '' });
    assert.equal(merged.street, 'Rua Digitada');
    assert.equal(merged.number, '10');
    assert.equal(merged.city, 'São Paulo');
    assert.equal(merged.zip_code, '01000000');
    // openEdit: vazio + salvo = salvo.
    const opened = mergeAddress(
      { street: '', number: '', city: '', zip_code: '', zip: '' },
      leadAddress,
    );
    assert.equal(opened.street, 'Rua A');
    assert.equal(opened.zip_code, '01000000');
  });

  it('formatAddressLine exibe só preenchidos, sem undefined', () => {
    const line = formatAddressLine(leadAddress);
    assert.ok(line.includes('Rua A'));
    assert.ok(line.includes('01000000'));
    assert.ok(!line.includes('undefined'));
    assert.ok(!line.includes('[object Object]'));
    assert.equal(formatAddressLine({}), '');
    assert.equal(formatAddressLine('Rua B, 20'), 'Rua B, 20');
  });

  it('buildContractModel usa zip_code do lead (não só zip)', () => {
    const m = buildContractModel({ full_name: 'Joice', address: leadAddress }, null);
    assert.ok(m.contractor.address.includes('Rua A'));
    assert.ok(m.contractor.address.includes('10'));
    assert.ok(m.contractor.address.includes('01000000'));
    const legacy = buildContractModel({ full_name: 'Joice', address: { street: 'Rua L', zip: '999' } }, null);
    assert.ok(legacy.contractor.address.includes('999'));
  });

  it('country/reference só compatibilidade (preservados quando existem)', () => {
    const n = normalizeAddress({ ...leadAddress, country: 'Brasil', reference: 'Perto do metrô' });
    assert.equal(n.country, 'Brasil');
    assert.equal(n.reference, 'Perto do metrô');
    assert.ok(formatAddressLine(n).includes('Brasil'));
  });
});
