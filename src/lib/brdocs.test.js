import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  onlyDigits, maskCNPJ, maskCPF, maskCEP, maskPhone,
  isValidCPF, isValidCNPJ, isValidEmail, isValidPhone, isValidCEP,
} from './brdocs.js';

describe('brdocs — máscaras', () => {
  it('CNPJ', () => {
    assert.equal(maskCNPJ('11222333000181'), '11.222.333/0001-81');
    assert.equal(maskCNPJ('11.222.333/0001-81xx'), '11.222.333/0001-81');
  });

  it('CPF', () => {
    assert.equal(maskCPF('12345678909'), '123.456.789-09');
  });

  it('CEP e telefone', () => {
    assert.equal(maskCEP('01001000'), '01001-000');
    assert.equal(maskPhone('11999998888'), '(11) 99999-8888');
    assert.equal(maskPhone('1133334444'), '(11) 3333-4444');
    assert.equal(onlyDigits('(11) 9'), '119');
  });
});

describe('brdocs — validadores', () => {
  it('CPF válido/inválido', () => {
    assert.equal(isValidCPF('123.456.789-09'), true);
    assert.equal(isValidCPF('12345678909'), true);
    assert.equal(isValidCPF('123.456.789-00'), false);
    assert.equal(isValidCPF('111.111.111-11'), false);
    assert.equal(isValidCPF('123'), false);
  });

  it('CNPJ válido/inválido', () => {
    assert.equal(isValidCNPJ('11.222.333/0001-81'), true);
    assert.equal(isValidCNPJ('11222333000181'), true);
    assert.equal(isValidCNPJ('11.222.333/0001-82'), false);
    assert.equal(isValidCNPJ('00000000000000'), false);
    assert.equal(isValidCNPJ('123'), false);
  });

  it('email, telefone e CEP', () => {
    assert.equal(isValidEmail('a@b.com'), true);
    assert.equal(isValidEmail('a@b'), false);
    assert.equal(isValidEmail('a b@c.com'), false);
    assert.equal(isValidPhone('(11) 99999-8888'), true);
    assert.equal(isValidPhone('1133334444'), true);
    assert.equal(isValidPhone('12345'), false);
    assert.equal(isValidCEP('01001-000'), true);
    assert.equal(isValidCEP('123'), false);
  });
});
