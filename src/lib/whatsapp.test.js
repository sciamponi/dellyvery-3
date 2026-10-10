import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COMMERCIAL_WHATSAPP, toWaNumber, buildWaUrl,
  buildLeadInboundMessage, buildAdminFollowUpMessage,
  buildLeadInboundUrl, buildLeadFollowUpUrl,
} from './whatsapp.js';

describe('whatsapp — números', () => {
  it('comercial configurado do projeto', () => {
    assert.equal(COMMERCIAL_WHATSAPP, '5511932314551');
  });

  it('normaliza 10/11 dígitos com DDI 55', () => {
    assert.equal(toWaNumber('(11) 99999-8888'), '5511999998888');
    assert.equal(toWaNumber('1133334444'), '551133334444');
    assert.equal(toWaNumber('5511999998888'), '5511999998888');
    assert.equal(toWaNumber('12345'), '');
    assert.equal(toWaNumber(null), '');
  });

  it('buildWaUrl codifica e rejeita sem número', () => {
    const url = buildWaUrl('5511999998888', 'Olá! Tudo bem?');
    assert.equal(url, 'https://wa.me/5511999998888?text=Ol%C3%A1!%20Tudo%20bem%3F');
    assert.throws(() => buildWaUrl('', 'oi'), /inválido/);
  });
});

describe('whatsapp — mensagens comerciais', () => {
  it('visitante→comercial sem afirmar aprovação/pagamento', () => {
    const msg = buildLeadInboundMessage({
      name: 'Maria', serviceLabel: 'Dellyvery', plan: 'Anual', paymentLabel: 'Pix',
    });
    assert.ok(msg.includes('Maria'));
    assert.ok(msg.includes('Dellyvery'));
    assert.ok(msg.includes('Anual'));
    assert.ok(msg.includes('Pix'));
    assert.ok(!/aprovad|pendente|cobra/i.test(msg));
  });

  it('sem pagamento: mensagem omite referência a Pix/cartão', () => {
    const msg = buildLeadInboundMessage({ name: 'Maria', serviceLabel: 'Dellyvery', plan: 'Anual' });
    assert.ok(msg.includes('Maria'));
    assert.ok(!/pix|cartão|pagamento/i.test(msg));
    const admin = buildAdminFollowUpMessage({ name: 'João Silva', serviceLabel: 'Dellyvery', plan: 'Anual' });
    assert.ok(admin.startsWith('Olá, João!'));
    assert.ok(!/pix|cartão/i.test(admin));
  });

  it('admin→interessado usa primeiro nome e referências', () => {
    const msg = buildAdminFollowUpMessage({
      name: 'João Silva', serviceLabel: 'Dellyvery', plan: 'Anual',
      paymentLabel: 'Pix', phone: '11999998888', email: 'j@x.com',
    });
    assert.ok(msg.startsWith('Olá, João!'));
    assert.ok(msg.includes('proposta comercial'));
    assert.ok(msg.includes('11999998888'));
    assert.ok(!/aprovad|pagamento pendente/i.test(msg));
  });

  it('periodicidade aparece nas duas mensagens (sem valores)', () => {
    const inbound = buildLeadInboundMessage({
      name: 'Maria', serviceLabel: 'Dellyvery', plan: 'Dellyvery Completo', billingLabel: 'Anual',
    });
    assert.ok(inbound.includes('Periodicidade desejada: Anual.'));
    assert.ok(!/R\$|preço|desconto/i.test(inbound));
    const admin = buildAdminFollowUpMessage({
      name: 'João Silva', serviceLabel: 'Dellyvery', plan: 'Dellyvery Completo', billingLabel: 'Mensal',
    });
    assert.ok(admin.includes('(Mensal)'));
    const follow = buildLeadFollowUpUrl({
      full_name: 'João Silva', service: 'dellyvery', plan_interest: 'Dellyvery Completo',
      billing_period: 'semestral', phone: '11999998888', email: 'j@x.com',
    });
    assert.ok(follow.startsWith('https://wa.me/5511999998888?text='));
    const inboundUrl = buildLeadInboundUrl({ name: 'Maria', serviceLabel: 'Dellyvery' });
    assert.ok(inboundUrl.startsWith(`https://wa.me/${COMMERCIAL_WHATSAPP}?text=`));
    assert.throws(() => buildLeadFollowUpUrl({ full_name: 'X', phone: '123' }), /telefone válido/);
  });
});
