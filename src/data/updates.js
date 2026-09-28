/**
 * Canal 📢 Atualizações: novidades entregues + roadmap.
 * Hardcoded (sem migration); futura tabela `changelog` quando preciso.
 * status: 'disponivel' | 'desenvolvimento' | 'embreve'
 */

export const UPDATE_TABS = [
  { id: 'destaques', label: '⭐ Destaques' },
  { id: 'novidades', label: '🆕 Novidades' },
  { id: 'melhorias', label: '🛠️ Melhorias' },
  { id: 'correcoes', label: '🔧 Correções' },
  { id: 'pagamentos', label: '💳 Pagamentos' },
  { id: 'embreve', label: '🔜 Em breve' },
];

export const STATUS_META = {
  disponivel: { label: 'Disponível', cls: 'bg-green-100 text-green-700', dot: '🟢' },
  desenvolvimento: { label: 'Em desenvolvimento', cls: 'bg-yellow-100 text-yellow-700', dot: '🟡' },
  embreve: { label: 'Em breve', cls: 'bg-muted text-muted-foreground', dot: '🔜' },
};

export const UPDATES = [
  // Destaques
  { id: 'u01', tab: 'destaques', icon: '🍔', title: 'Cardápio público no Supabase', desc: 'Empresa, categorias e produtos carregados via RPC pública, sem acesso direto às tabelas.', status: 'disponivel' },
  { id: 'u02', tab: 'destaques', icon: '📱', title: 'Cards mobile sem distorção', desc: 'Imagens com proporção preservada e layout compacto em 320–430px.', status: 'disponivel' },
  { id: 'u03', tab: 'destaques', icon: '🚴', title: 'Motoboy padrão + autoatribuição', desc: 'Delivery recebe o entregador automaticamente na chegada do pedido.', status: 'disponivel' },
  // Novidades
  { id: 'u04', tab: 'novidades', icon: '🔗', title: 'Slug e endereço personalizado', desc: 'Edite o endereço do cardápio com validação e proteção contra duplicados.', status: 'disponivel' },
  { id: 'u05', tab: 'novidades', icon: '🔳', title: 'QR Code do cardápio', desc: 'Gerado localmente, com download em PNG e compartilhamento no WhatsApp.', status: 'disponivel' },
  { id: 'u06', tab: 'novidades', icon: '💰', title: 'Financeiro no Supabase', desc: 'Receita, ticket médio e breakdowns por status, tipo e pagamento.', status: 'disponivel' },
  // Melhorias
  { id: 'u07', tab: 'melhorias', icon: '🧾', title: 'Checkout Supabase-only', desc: 'Criação de pedido via RPC com preços calculados no servidor.', status: 'disponivel' },
  { id: 'u08', tab: 'melhorias', icon: '⚙️', title: 'Configurações reorganizadas', desc: 'Nova aba Cardápio com divulgação; Delivery com motoboy padrão.', status: 'disponivel' },
  { id: 'u09', tab: 'melhorias', icon: '🔔', title: 'Alerta de novo pedido', desc: 'Modal, som e destaque vermelho para pedidos recém-chegados.', status: 'disponivel' },
  // Correções
  { id: 'u10', tab: 'correcoes', icon: '🖼️', title: 'Fotos nos pedidos e tracking', desc: 'Itens exibem a imagem atual do produto, com fallback elegante.', status: 'disponivel' },
  { id: 'u11', tab: 'correcoes', icon: '📡', title: 'Realtime estável', desc: 'Canal de pedidos com reconexão segura e sem duplicar alertas.', status: 'disponivel' },
  // Pagamentos (planejamento)
  { id: 'u12', tab: 'pagamentos', icon: '💳', title: 'Pagamentos online', desc: 'Desenho aprovado: Asaas + Mercado Pago via abstração PaymentProvider.', status: 'desenvolvimento' },
  { id: 'u13', tab: 'pagamentos', icon: '🟢', title: 'Mercado Pago', desc: 'PIX e cartão no checkout do cliente e na assinatura do lojista.', status: 'embreve' },
  { id: 'u14', tab: 'pagamentos', icon: '🔵', title: 'Asaas', desc: 'Cobrança da mensalidade e meios adicionais de pagamento.', status: 'embreve' },
  // Em breve
  { id: 'u15', tab: 'embreve', icon: '📣', title: 'Marketing', desc: 'Campanhas e divulgação dos produtos para os clientes.', status: 'embreve' },
  { id: 'u16', tab: 'embreve', icon: '👥', title: 'Clientes / CRM', desc: 'Mais ferramentas de relacionamento e gestão da base.', status: 'embreve' },
  { id: 'u17', tab: 'embreve', icon: '📲', title: 'WhatsApp', desc: 'Comunicação e automação pelo WhatsApp.', status: 'embreve' },
  { id: 'u18', tab: 'embreve', icon: '🎯', title: 'Campanhas e promoções', desc: 'Ofertas, promoções e alcance de clientes.', status: 'embreve' },
  { id: 'u19', tab: 'embreve', icon: '🖨️', title: 'Cardápio para impressão', desc: 'Materiais com QR Code para mesas, balcão e embalagens.', status: 'embreve' },
  { id: 'u20', tab: 'embreve', icon: '🌐', title: 'Domínio personalizado', desc: 'Use seu próprio domínio no cardápio.', status: 'embreve' },
  { id: 'u21', tab: 'embreve', icon: '🚴', title: 'Gestão de entregadores', desc: 'Mais recursos para entregadores e operações.', status: 'embreve' },
  { id: 'u22', tab: 'embreve', icon: '👨‍💼', title: 'Equipe e permissões', desc: 'Usuários, funções e permissões da empresa.', status: 'embreve' },
  { id: 'u23', tab: 'embreve', icon: '📊', title: 'Relatórios avançados', desc: 'Vendas, produtos e desempenho em detalhe.', status: 'embreve' },
  { id: 'u24', tab: 'embreve', icon: '🤖', title: 'Automação e IA', desc: 'Recursos inteligentes para operação e atendimento.', status: 'embreve' },
];

export function updatesByTab(tab) {
  return UPDATES.filter((u) => u.tab === tab);
}
