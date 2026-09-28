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

const D = (what, how, why, usage) => ({ what, how, why, usage });

export const NEW_FEATURE_PDV_V1 = 'NEW_FEATURE_PDV_V1';

export const UPDATES = [
  // Destaques
  { id: 'u00', tab: 'destaques', sort_order: 0, icon: '🧾', title: 'Novo PDV para criar pedidos', desc: 'Agora você pode criar pedidos diretamente pelo Dellyvery usando o novo PDV. Escolha os produtos, monte o pedido e finalize tudo pelo sistema.', status: 'disponivel',
    details: D('O PDV permite registrar pedidos de mesa, retirada ou entrega diretamente pelo painel.',
      'Escolha os produtos do cardápio, ajuste quantidades, informe mesa/cliente/endereço e finalize — o pedido entra na fila como qualquer outro.',
      'Atenda balcão, telefone e presencial sem sair do sistema.',
      'Abra o PDV pelo botão na Dashboard, monte o pedido e clique em Finalizar pedido.') },
  { id: 'u01', tab: 'destaques', sort_order: 1, icon: '🍔', title: 'Cardápio público', desc: 'Compartilhe seu QR Code e facilite na hora do cliente fazer um pedido. Tudo chega organizado para você.', status: 'disponivel',
    details: D('Seu cardápio fica disponível em um link público, rápido e sempre atualizado.',
      'O cliente aponta a câmera do celular para o QR Code do seu cardápio e é direcionado para fazer o pedido.',
      'O cliente não precisa procurar ou digitar o endereço do seu cardápio. É só apontar a câmera e acessar.',
      'Compartilhe o link ou o QR Code. Quando você alterar produtos, preços ou informações no painel, o cardápio é atualizado automaticamente.') },
  { id: 'u02', tab: 'destaques', sort_order: 2, icon: '📋', title: 'Pedidos organizados', desc: 'Receba os pedidos e acompanhe tudo em um só lugar, sem precisar ficar procurando mensagens ou anotações.', status: 'disponivel',
    details: D('Uma área onde você consegue visualizar os pedidos que chegaram e acompanhar cada pedido.',
      'Os pedidos aparecem organizados de acordo com o andamento: novo, confirmado, em preparo, saiu para entrega e finalizado.',
      'Você sabe exatamente quais pedidos precisam de atenção e evita esquecer algum pedido.',
      'Entre em Pedidos, escolha o pedido e avance conforme ele for sendo preparado e entregue.') },
  { id: 'u03', tab: 'destaques', sort_order: 3, icon: '🔔', title: 'Novos pedidos', desc: 'Saiba rapidamente quando um novo pedido chegar para você não deixar seu cliente esperando.', status: 'disponivel',
    details: D('Um aviso que aparece quando um novo pedido é recebido.',
      'Quando chega um pedido, o sistema mostra o aviso e destaca que existe uma nova solicitação.',
      'Você percebe rapidamente que existe um novo pedido para atender.',
      'Ao receber o aviso, abra o pedido, confira os detalhes e confirme o atendimento.') },
  // Novidades
  { id: 'u04', tab: 'novidades', sort_order: 1, icon: '🚴', title: 'Motoboy padrão', desc: 'Deixe um motoboy definido para receber automaticamente os pedidos de entrega.', status: 'disponivel',
    details: D('Uma opção para escolher o motoboy que será usado como padrão nas entregas.',
      'Quando chega um novo pedido de delivery, o sistema pode atribuir automaticamente o motoboy escolhido.',
      'Você economiza tempo e não precisa escolher o mesmo motoboy toda vez.',
      'Entre em Configurações → Delivery, escolha o motoboy padrão e ative a opção de atribuição automática.') },
  { id: 'u05', tab: 'novidades', sort_order: 2, icon: '👥', title: 'Equipe', desc: 'Organize as pessoas que trabalham com você e defina quem pode acessar cada parte do sistema.', status: 'disponivel',
    details: D('Uma área para cadastrar e organizar sua equipe.',
      'Você pode adicionar pessoas e definir suas funções dentro do estabelecimento.',
      'Cada pessoa pode ter acesso somente ao que precisa para trabalhar.',
      'Acesse Equipe, cadastre o funcionário e escolha a função correspondente.') },
  { id: 'u06', tab: 'novidades', sort_order: 3, icon: '💰', title: 'Financeiro', desc: 'Acompanhe quanto sua loja vendeu e veja as informações financeiras dos seus pedidos.', status: 'disponivel',
    details: D('Uma área para acompanhar os resultados das vendas.',
      'O sistema reúne os pedidos finalizados e apresenta os valores de forma organizada.',
      'Você consegue entender melhor quanto está vendendo sem precisar fazer as contas manualmente.',
      'Acesse Financeiro e escolha o período que deseja consultar.') },
  // Melhorias
  { id: 'u07', tab: 'melhorias', sort_order: 1, icon: '📱', title: 'Compartilhe seu cardápio', desc: 'Divulgue seu cardápio facilmente pelo WhatsApp, redes sociais ou onde quiser.', status: 'disponivel',
    details: D('Um link exclusivo para seus clientes acessarem seu cardápio.',
      'Você copia o link ou utiliza o botão de compartilhamento para enviar para seus clientes.',
      'Seu cliente chega direto ao cardápio sem precisar procurar sua loja.',
      'Entre em Configurações → Cardápio, copie o link ou use a opção de compartilhar.') },
  { id: 'u08', tab: 'melhorias', sort_order: 2, icon: '📲', title: 'QR Code', desc: 'Tenha seu próprio QR Code para colocar nas mesas, balcão, embalagens ou divulgar nas redes sociais.', status: 'disponivel',
    details: D('Uma imagem que leva diretamente para o seu cardápio.',
      'O cliente aponta a câmera do celular para o QR Code e acessa seu cardápio.',
      'Facilita o acesso e reduz o caminho até o pedido.',
      'Baixe seu QR Code em Configurações → Cardápio e coloque onde seus clientes possam escanear.') },
  { id: 'u09', tab: 'melhorias', sort_order: 3, icon: '🛍️', title: 'Produtos e categorias', desc: 'Organize seus produtos para deixar o cardápio mais fácil de entender e comprar.', status: 'disponivel',
    details: D('Uma área para cadastrar produtos e separar os itens por categorias.',
      'Você cria categorias como Lanches, Bebidas ou Sobremesas e adiciona os produtos dentro delas.',
      'Seu cliente encontra mais rapidamente aquilo que procura.',
      'Acesse Cardápio, cadastre suas categorias e depois adicione seus produtos com foto, preço e informações.') },
  // Correções
  { id: 'u10', tab: 'correcoes', sort_order: 1, icon: '🛵', title: 'Entregas', desc: 'Organize suas entregas e acompanhe os pedidos que precisam chegar até seus clientes.', status: 'disponivel',
    details: D('Ferramentas para ajudar no controle dos pedidos de delivery.',
      'Os pedidos de entrega podem ser acompanhados e encaminhados para o motoboy responsável.',
      'Você consegue saber quais pedidos estão aguardando entrega e quem está responsável por eles.',
      'Abra o pedido, confira o endereço e atribua o motoboy quando necessário.') },
  { id: 'u11', tab: 'correcoes', sort_order: 2, icon: '🔐', title: 'Seu acesso', desc: 'Tenha seu próprio acesso ao sistema e mantenha as informações da sua loja organizadas.', status: 'disponivel',
    details: D('Seu acesso pessoal ao painel de gerenciamento.',
      'Você entra com seu e-mail e senha para acessar as ferramentas da sua loja.',
      'Suas informações ficam organizadas em um único lugar e o acesso pode ser protegido.',
      'Entre pelo seu acesso e, quando necessário, altere sua senha em Perfil.') },
  // Pagamentos (planejamento)
  { id: 'u12', tab: 'pagamentos', sort_order: 1, icon: '💳', title: 'Pagamentos online', desc: 'Desenho aprovado: Asaas + Mercado Pago via abstração PaymentProvider.', status: 'desenvolvimento' },
  { id: 'u13', tab: 'pagamentos', sort_order: 2, icon: '🟢', title: 'Mercado Pago', desc: 'PIX e cartão no checkout do cliente e na assinatura do lojista.', status: 'embreve' },
  { id: 'u14', tab: 'pagamentos', sort_order: 3, icon: '🔵', title: 'Asaas', desc: 'Cobrança da mensalidade e meios adicionais de pagamento.', status: 'embreve' },
  // Em breve
  { id: 'u15', tab: 'embreve', sort_order: 1, icon: '📣', title: 'Marketing', desc: 'Campanhas e divulgação dos produtos para os clientes.', status: 'embreve' },
  { id: 'u16', tab: 'embreve', sort_order: 2, icon: '👥', title: 'Clientes / CRM', desc: 'Mais ferramentas de relacionamento e gestão da base.', status: 'embreve' },
  { id: 'u17', tab: 'embreve', sort_order: 3, icon: '📲', title: 'WhatsApp', desc: 'Comunicação e automação pelo WhatsApp.', status: 'embreve' },
  { id: 'u18', tab: 'embreve', sort_order: 4, icon: '🎯', title: 'Campanhas e promoções', desc: 'Ofertas, promoções e alcance de clientes.', status: 'embreve' },
  { id: 'u19', tab: 'embreve', sort_order: 5, icon: '🖨️', title: 'Cardápio para impressão', desc: 'Materiais com QR Code para mesas, balcão e embalagens.', status: 'embreve' },
  { id: 'u20', tab: 'embreve', sort_order: 6, icon: '🌐', title: 'Domínio personalizado', desc: 'Use seu próprio domínio no cardápio.', status: 'embreve' },
  { id: 'u21', tab: 'embreve', sort_order: 7, icon: '🚴', title: 'Gestão de entregadores', desc: 'Mais recursos para entregadores e operações.', status: 'embreve' },
  { id: 'u22', tab: 'embreve', sort_order: 8, icon: '👨‍💼', title: 'Equipe e permissões', desc: 'Usuários, funções e permissões da empresa.', status: 'embreve' },
  { id: 'u23', tab: 'embreve', sort_order: 9, icon: '📊', title: 'Relatórios avançados', desc: 'Vendas, produtos e desempenho em detalhe.', status: 'embreve' },
  { id: 'u24', tab: 'embreve', sort_order: 10, icon: '🤖', title: 'Automação e IA', desc: 'Recursos inteligentes para operação e atendimento.', status: 'embreve' },
];

const TEMPLATE_DETAILS = {
  desenvolvimento: {
    what: 'Estamos preparando essa novidade para deixar seu dia a dia ainda mais fácil.',
    how: 'Nossa equipe está construindo e testando antes de liberar.',
    why: 'Queremos entregar pronto e confiável.',
    usage: 'Acompanhe por aqui; avisaremos quando liberar.',
  },
  embreve: {
    what: 'Essa novidade está nos nossos próximos passos. Em breve você poderá utilizar esse recurso.',
    how: 'Entra na fila de desenvolvimento após a fase atual.',
    why: 'Priorizamos o que mais impacta sua operação primeiro.',
    usage: 'Fique de olho nesta página para novidades.',
  },
};

/** Detalhe exibido no modal: próprio do item ou template por status. */
export function detailsOf(item) {
  if (item?.details) return item.details;
  return TEMPLATE_DETAILS[item?.status] || TEMPLATE_DETAILS.embreve;
}

export function updatesByTab(tab) {
  return UPDATES.filter((u) => u.tab === tab).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}
