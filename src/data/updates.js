/**
 * Canal 📢 Atualizações: novidades entregues + roadmap.
 * Hardcoded (sem migration); futura tabela `changelog` quando preciso.
 * status: 'disponivel' | 'desenvolvimento' | 'embreve'
 * Processo: a cada publicação, adicionar aqui SOMENTE o que foi entregue e
 * testado (nunca o planejado), com id/sort_order sequenciais na aba, e
 * atualizar as contagens em updates.test.js.
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
  { id: 'u25', tab: 'destaques', sort_order: 4, icon: '🖨️', title: 'Cupom de cozinha e etiqueta', desc: 'Imprima o cupom de produção para a cozinha e a etiqueta de identificação do pacote de entrega.', status: 'disponivel',
    details: D('Cupom de produção com itens, complementos e observações em destaque, mais etiqueta do pacote com cliente, endereço e resumo.',
      'Após salvar o pedido no PDV, use os botões de impressão; também dá para reimprimir sem criar outro pedido.',
      'A cozinha recebe o essencial para produzir e o entregador identifica o pacote correto.',
      'No PDV, finalize o pedido e clique em Cupom cozinha ou Etiqueta pacote.') },
  { id: 'u31', tab: 'destaques', sort_order: 5, icon: '🪑', title: 'Mesas com QR Code', desc: 'Cada mesa ganha um QR Code: o cliente escaneia e faz o pedido direto na mesa.', status: 'disponivel',
    details: D('Uma página de Mesas onde cada mesa tem seu próprio QR Code com código seguro.',
      'O cliente aponta a câmera para o QR da mesa e o pedido já chega vinculado àquela mesa, sem digitação.',
      'Menos erro de mesa e atendimento mais rápido no salão.',
      'Abra Mesas, cadastre suas mesas e imprima os QR Codes para colocar em cada uma.') },
  { id: 'u32', tab: 'destaques', sort_order: 6, icon: '🖨️', title: 'Impressão ao aceitar', desc: 'Ao aceitar um pedido, o sistema já oferece a impressão do cupom na hora.', status: 'disponivel',
    details: D('Quando você aceita um pedido, aparece a opção de imprimir o cupom.',
      'Se a impressora falhar, dá para tentar de novo sem precisar aceitar o pedido outra vez; o modo manual continua valendo.',
      'A cozinha começa a produzir mais rápido, sem etapa esquecida.',
      'Aceite o pedido normalmente e confirme a impressão quando ela aparecer.') },
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
  { id: 'u26', tab: 'novidades', sort_order: 4, icon: '🍟', title: 'Sugestões no checkout', desc: 'Ofereça acompanhamentos, bebidas e sobremesas em etapas opcionais antes da confirmação.', status: 'disponivel',
    details: D('Etapas opcionais de venda adicional no pedido online: acompanhamentos, depois bebidas, depois sobremesas.',
      'O cliente pode pular, voltar, ajustar quantidades; nada é adicionado sozinho e o total é recalculado.',
      'Aumenta o ticket sem atrito na compra.',
      'Acontece sozinho no checkout quando o cardápio tem essas categorias.') },
  { id: 'u27', tab: 'novidades', sort_order: 5, icon: '🥇', title: 'Selo de primeiro pedido', desc: 'Identifique de relance quando um pedido é o primeiro daquele cliente na sua empresa.', status: 'disponivel',
    details: D('Um selo visível no Kanban e nos detalhes quando o cliente identificado ainda não tem pedidos anteriores (cancelados não contam).',
      'A verificação usa o histórico já carregado, sem consultas extras, e respeita cada empresa.',
      'Dê boas-vindas e atenção especial a quem compra pela primeira vez.',
      'Aparece sozinho nos cartões e no modal do pedido.') },
  { id: 'u28', tab: 'novidades', sort_order: 6, icon: '🔗', title: 'Vincular cliente e mesa', desc: 'Complete depois: vincule um cliente ou uma mesa a pedidos de balcão, sem recriar o pedido.', status: 'disponivel',
    details: D('Nos detalhes do pedido, pesquise um cliente da empresa ou escolha uma mesa ativa e confirme o vínculo.',
      'O vínculo atualiza o pedido e registra no histórico; número, itens e total são preservados, sem trocar o tipo do pedido.',
      'Pedidos avulsos ganham identificação sem retrabalho.',
      'Abra o pedido, use a seção Vínculos e confirme.') },
  { id: 'u33', tab: 'novidades', sort_order: 7, icon: '🛵', title: 'Aviso ao entregador', desc: 'Encaminhe o pedido ao entregador com mensagem pronta e acompanhe o histórico.', status: 'disponivel',
    details: D('Um botão que monta a mensagem da entrega (pedido, cliente, endereço, valor e pagamento) e abre a conversa com o entregador.',
      'O envio é manual por enquanto; o sistema registra cada etapa: pendente, iniciado e confirmado, por empresa.',
      'Você sabe exatamente quais entregas já foram avisadas e quais faltam.',
      'Abra o pedido em entrega, confira o entregador e use o botão de avisar.') },
  { id: 'u34', tab: 'novidades', sort_order: 8, icon: '💵', title: 'Fechamento de repasses', desc: 'Feche os valores a repassar a cada entregador com base nas taxas dos pedidos finalizados.', status: 'disponivel',
    details: D('Uma área que reúne os pedidos finalizados de cada entregador e soma as taxas de entrega.',
      'Você confere os pedidos incluídos, registra o pagamento do repasse e acompanha o histórico por período.',
      'Sem planilha paralela para acertar com a equipe de entrega.',
      'Acesse Financeiro, veja a seção de entregadores e confirme os repasses pagos.') },
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
  { id: 'u29', tab: 'melhorias', sort_order: 4, icon: '✅', title: 'Baixa de entrega confirmada', desc: 'Conclua entregas com confirmação e mantenha as colunas de finalizados sempre visíveis.', status: 'disponivel',
    details: D('O cartão em entrega mostra Concluir entrega com pedido de confirmação; Finalizado e Cancelado têm coluna própria mesmo quando inativos.',
      'A baixa usa a mesma API de status, preserva histórico e não altera pagamento.',
      'Sem baixas acidentais e sem pedidos sumidos do Kanban.',
      'No Kanban, clique em Concluir entrega e confirme.') },
  { id: 'u35', tab: 'melhorias', sort_order: 5, icon: '🗺️', title: 'Entrega por região no mapa', desc: 'Desenhe suas áreas de entrega no mapa e deixe a taxa certa sair sozinha no checkout.', status: 'disponivel',
    details: D('Você desenha no mapa as regiões que atende, cada uma com sua taxa e pedido mínimo.',
      'O cliente informa o endereço ou usa a localização, e o sistema encontra a região, calcula a taxa e avisa se está fora da área.',
      'Sem adivinhar taxa e sem vender para onde você não entrega.',
      'Acesse Configurações → Entregas, desenhe suas áreas e defina taxa e mínimo de cada uma.') },
  { id: 'u36', tab: 'melhorias', sort_order: 6, icon: '🧩', title: 'Montador de produtos e extras', desc: 'Monte lanches por etapas e reaproveite ingredientes e adicionais em vários produtos.', status: 'disponivel',
    details: D('Etapas de montagem por produto (obrigatórias ou opcionais) com ingredientes cadastrados uma única vez e reutilizados.',
      'O cliente monta o pedido etapa por etapa; o sistema valida, precifica e guarda tudo igual no cupom.',
      'Cardápio flexível sem retrabalho de cadastro.',
      'Cadastre ingredientes e monte as etapas de cada produto no Cardápio.') },
  { id: 'u37', tab: 'melhorias', sort_order: 7, icon: '🛒', title: 'Carrinho editável e sugestões', desc: 'Ajuste quantidades no carrinho e receba sugestões antes de confirmar.', status: 'disponivel',
    details: D('No carrinho dá para aumentar, diminuir, editar e remover itens antes de fechar.',
      'Durante o pedido, o sistema sugere acompanhamentos para completar — nada entra sozinho.',
      'Menos desistência e ticket maior sem atrito.',
      'É automático no cardápio e no checkout.') },
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
  { id: 'u30', tab: 'correcoes', sort_order: 3, icon: '🧾', title: 'Totais e PDV por modalidade', desc: 'Totais sempre visíveis nos cartões e PDV validando cada modalidade (mesa, balcão, entrega).', status: 'disponivel',
    details: D('O total do cartão nunca trunca nem some; valor ausente aparece como indisponível em vez de enganar.',
      'O PDV abre no balcão, valida mesa só para mesa, exige dados só na entrega e impede toques duplos.',
      'Menos erros de digitação e de modalidade no salão.',
      'Opere normalmente no PDV; as regras aparecem como mensagens quando faltar algo.') },
  { id: 'u38', tab: 'correcoes', sort_order: 4, icon: '🛡️', title: 'Proteções reforçadas', desc: 'Checagens extras no servidor para pedidos, valores e acessos de cada restaurante.', status: 'disponivel',
    details: D('O sistema agora confere no servidor quem pode mexer em cada pedido, valida totais e descontos na hora de salvar e impede pedidos duplicados.',
      'As verificações acontecem automaticamente a cada operação, sem mudar sua rotina.',
      'Mais segurança para os dados da sua loja sem complicar o uso.',
      'Nada para configurar: as proteções já valem para todos os pedidos novos.') },
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
