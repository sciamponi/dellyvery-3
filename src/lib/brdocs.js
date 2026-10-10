// DELLVERY 3 — Validadores e máscaras de documentos BR (puros, sem deps).
// CNPJ/CPF com dígitos verificadores; telefone BR; e-mail; CEP.

export function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

export function maskCNPJ(value) {
  const d = onlyDigits(value).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function maskCPF(value) {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function maskCEP(value) {
  const d = onlyDigits(value).slice(0, 8);
  return d.replace(/(\d{5})(\d)/, '$1-$2');
}

export function maskPhone(value) {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
  }
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
}

function allSame(digits) {
  return digits.length > 0 && digits.split('').every((c) => c === digits[0]);
}

function checkDigits(base, weights) {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) sum += Number(base[i]) * weights[i];
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

export function isValidCPF(value) {
  const d = onlyDigits(value);
  if (d.length !== 11 || allSame(d)) return false;
  const d1 = checkDigits(d.slice(0, 9), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigits(d.slice(0, 9) + d1, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[9]) && d2 === Number(d[10]);
}

export function isValidCNPJ(value) {
  const d = onlyDigits(value);
  if (d.length !== 14 || allSame(d)) return false;
  const d1 = checkDigits(d.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = checkDigits(d.slice(0, 12) + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}

export function isValidPhone(value) {
  const d = onlyDigits(value);
  return d.length === 10 || d.length === 11;
}

export function isValidCEP(value) {
  return onlyDigits(value).length === 8;
}
