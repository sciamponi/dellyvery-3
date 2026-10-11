// DELLVERY 3 — Validação do rascunho do PDV (pura, testável).
// Regras por modalidade (espelham create_order + UX do PDV):
// - mesa: exige número da mesa; cliente opcional (avulso).
// - retirada (balcão): sem mesa, sem cliente obrigatório.
// - delivery: exige nome + telefone + endereço; nunca exige mesa.
// Retorna null quando válido, ou { title, description } do primeiro erro
// (ordem estável = uma única notificação por tentativa).

export function validatePdvDraft({
  items = [], orderType = 'retirada', tableNumber = '',
  customer = {}, address = '', paymentMethod = '', changeFor = '',
} = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    return { title: 'Pedido vazio', description: 'Adicione ao menos um produto.' };
  }
  if (orderType === 'mesa' && !String(tableNumber || '').trim()) {
    return { title: 'Mesa obrigatória', description: 'Informe o número da mesa.' };
  }
  if (orderType === 'delivery') {
    if (!String(customer?.name || '').trim() || !String(customer?.phone || '').trim()) {
      return { title: 'Cliente obrigatório', description: 'Para entrega, informe nome e telefone.' };
    }
    if (!String(address || '').trim()) {
      return { title: 'Endereço obrigatório', description: 'Informe o endereço de entrega.' };
    }
  }
  if (paymentMethod === 'Dinheiro' && String(changeFor ?? '').trim() !== '') {
    const v = Number(String(changeFor).replace(',', '.'));
    if (!(v > 0)) {
      return { title: 'Troco inválido', description: 'Informe um valor maior que zero.' };
    }
  }
  return null;
}
