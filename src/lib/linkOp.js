// DELLVERY 3 — Identidade de operação dos vínculos (puro, testável).
// Condição de corrida: salvar comanda (async) e, antes da resposta, o
// operador abre outra seção. Sem identidade, o setLinking(null) da
// operação antiga fecha a seção nova. Regra: só a operação vigente
// (sem navegação no meio) pode fechar; dados + toast sempre aplicam.
//
// Uso no componente:
//   const tracker = useRef(null); if (!tracker.current) tracker.current = createLinkOpTracker();
//   openers/Fechar/reset  -> tracker.current.userNavigated()
//   início do save        -> const opId = tracker.current.beginOp()
//   conclusão             -> if (tracker.current.shouldClose(opId)) setLinking(null)
export function createLinkOpTracker() {
  let seq = 0;
  return {
    // Inicia operação; retorna o id capturado por ela.
    beginOp() {
      seq += 1;
      return seq;
    },
    // Operador trocou de seção (ou reset): invalida fechamentos pendentes.
    userNavigated() {
      seq += 1;
    },
    // A operação opId pode fechar a seção atual?
    shouldClose(opId) {
      return opId === seq;
    },
    // Troca de pedido/desmontagem: invalida tudo pendente.
    reset() {
      seq += 1;
    },
  };
}
