import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_STAGE_SEED,
  TERMINAL_MAPS_TO,
  isValidHexColor,
  isLegacyStageKey,
  slugifyStageKey,
  fromSupabaseStage,
  toSupabaseStagePatch,
  listStages,
  createStage,
  updateStage,
  setStageActive,
  deleteStage,
  reorderStages,
  sortStages,
  visibleStages,
  flowStages,
  displayStages,
  stageForStatus,
  resolveAdvanceTarget,
  resolveRegressTarget,
  resolveCardPrimary,
  assertSingleStep,
  advanceOrder,
  regressOrder,
  shouldAutoCloseOnAction,
} from './orderStages.js';

function seedRows() {
  return LEGACY_STAGE_SEED.map((s, i) => ({
    id: `st-${s.key}`,
    company_id: 'c1',
    stage_key: s.key,
    maps_to: s.mapsTo,
    name: s.name,
    color: s.color,
    sort_order: s.position,
    is_initial: s.isInitial,
    is_final: s.isFinal,
    active: true,
    created_at: 't',
    updated_at: 't',
  }));
}

// Mock supabase-js suficiente p/ listStages (select/eq/order) e
// setStageActive/deleteStage (orders limit 1), CRUD de stages e
// advance/regress via rpc manage_order.
function createStagesMock({ stages = seedRows(), ordersInStatus = {}, rpcRow = null } = {}) {
  const calls = { insert: [], update: [], delete: [], rpc: [] };
  const store = stages.map((s) => ({ ...s }));
  const table = (name) => {
    const filters = {};
    const chain = {
      _pending: null,
      select: () => chain,
      eq: (k, v) => { filters[k] = v; return chain; },
      order: () => chain,
      limit: () => chain,
      insert: (p) => { calls.insert.push({ table: name, payload: p }); chain._pending = { op: 'insert', payload: p }; return chain; },
      update: (p) => { calls.update.push({ table: name, payload: p }); chain._pending = { op: 'update', payload: p, filters }; return chain; },
      delete: () => { calls.delete.push({ table: name }); chain._pending = { op: 'delete', filters }; return chain; },
      maybeSingle: async () => {
        if (name === 'restaurant_order_stages' && chain._pending?.op === 'insert') {
          const p = chain._pending.payload;
          return {
            data: {
              id: 'st-new', company_id: p.company_id, stage_key: p.stage_key,
              maps_to: p.maps_to, name: p.name, color: p.color,
              sort_order: p.sort_order, is_initial: p.is_initial,
              is_final: p.is_final, active: p.active,
              created_at: 't', updated_at: 't',
            },
            error: null,
          };
        }
        if (name === 'restaurant_order_stages' && chain._pending?.op === 'update') {
          const row = store.find((s) => s.id === chain._pending.filters.id);
          if (!row) return { data: null, error: null };
          Object.assign(row, chain._pending.payload);
          return { data: { ...row }, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve) => {
        if (name === 'restaurant_order_stages') {
          let rows = store.filter((s) => !filters.company_id || s.company_id === filters.company_id);
          resolve({ data: rows, error: null });
        } else if (name === 'orders') {
          const hit = filters.status && ordersInStatus[filters.status];
          resolve({ data: hit ? [{ id: 'o-in-status' }] : [], error: null });
        } else {
          resolve({ data: [], error: null });
        }
      },
    };
    return chain;
  };
  return {
    calls,
    from: (name) => table(name),
    rpc: async (fn, args) => {
      calls.rpc.push({ fn, args });
      if (rpcRow) return { data: rpcRow, error: null };
      return { data: null, error: null };
    },
  };
}

const mapped = (rows) => rows.map((r) => ({
  id: r.id, key: r.stage_key, mapsTo: r.maps_to, name: r.name,
  color: r.color, position: r.sort_order, active: r.active,
  isInitial: r.is_initial, isFinal: r.is_final,
}));

describe('orderStages — seed e mapeamento', () => {
  it('seed tem 7 etapas, ordem e flags inicial/final', () => {
    assert.equal(LEGACY_STAGE_SEED.length, 7);
    assert.deepEqual(LEGACY_STAGE_SEED.map((s) => s.position), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(LEGACY_STAGE_SEED.find((s) => s.isInitial).key, 'novo');
    assert.equal(LEGACY_STAGE_SEED.find((s) => s.isFinal).key, 'finalizado');
    assert.ok(LEGACY_STAGE_SEED.every((s) => s.key === s.mapsTo));
  });

  it('fromSupabaseStage: sort_order->position, flags, sem company_id no patch', () => {
    const s = fromSupabaseStage(seedRows()[0]);
    assert.equal(s.position, 0);
    assert.equal(s.key, 'novo');
    assert.equal(s.mapsTo, 'novo');
    assert.equal(s.isInitial, true);
  });

  it('cores e chaves', () => {
    assert.ok(isValidHexColor('#3b82f6'));
    assert.ok(!isValidHexColor('blue'));
    assert.ok(!isValidHexColor('#12345'));
    assert.ok(isLegacyStageKey('novo'));
    assert.ok(!isLegacyStageKey('producao-x'));
    assert.ok(slugifyStageKey('Produção Final!').startsWith('producao-final'));
  });

  it('patch nunca envia company_id/stage_key; valida nome/cor', () => {
    const p = toSupabaseStagePatch({ name: ' X ', color: '#abcdef', company_id: 'OUTRA', stage_key: 'y' }, 'custom-1');
    assert.deepEqual(p, { name: 'X', color: '#abcdef' });
    assert.throws(() => toSupabaseStagePatch({ name: '  ' }, 'k'), /obrigatório/);
    assert.throws(() => toSupabaseStagePatch({ color: 'red' }, 'k'), /Cor inválida/);
  });

  it('chave legada ignora mapsTo (travado no banco); custom exige válido', () => {
    assert.deepEqual(toSupabaseStagePatch({ mapsTo: 'finalizado' }, 'novo'), {});
    assert.deepEqual(toSupabaseStagePatch({ mapsTo: 'em_preparo' }, 'producao-1'), { maps_to: 'em_preparo' });
    assert.throws(() => toSupabaseStagePatch({ mapsTo: 'cancelado' }, 'x-1'), /exceto cancelado/);
    assert.throws(() => toSupabaseStagePatch({ mapsTo: 'invalido' }, 'x-1'), /válido/);
  });
});

describe('orderStages — fluxo puro (uma etapa por vez)', () => {
  it('sort/visible/flow: inativas e cancelado fora do fluxo', () => {
    const stages = mapped(seedRows());
    assert.equal(sortStages([...stages].reverse())[0].key, 'novo');
    assert.equal(flowStages(stages).length, 6);
    assert.ok(!flowStages(stages).some((s) => s.mapsTo === 'cancelado'));
    const withInactive = stages.map((s) => (s.key === 'confirmado' ? { ...s, active: false } : s));
    assert.equal(visibleStages(withInactive).length, 6);
    assert.ok(!flowStages(withInactive).some((s) => s.key === 'confirmado'));
  });

  it('stageForStatus: natural + fallback (pedido antigo nunca some)', () => {
    const stages = mapped(seedRows());
    assert.equal(stageForStatus(stages, 'em_preparo').key, 'em_preparo');
    const hidden = stages.map((s) => (s.mapsTo === 'em_preparo' ? { ...s, active: false } : s));
    assert.equal(stageForStatus(hidden, 'em_preparo').key, 'novo');
    assert.equal(stageForStatus([], 'novo'), null);
  });

  it('avanço legado preservado: delivery pula aguardando_retirada; retirada pula saiu_entrega', () => {
    const stages = mapped(seedRows());
    assert.equal(resolveAdvanceTarget(stages, { status: 'novo', order_type: 'delivery' }).targetStatus, 'confirmado');
    assert.equal(
      resolveAdvanceTarget(stages, { status: 'em_preparo', order_type: 'delivery' }).targetStatus,
      'saiu_entrega',
    );
    assert.equal(
      resolveAdvanceTarget(stages, { status: 'em_preparo', order_type: 'retirada' }).targetStatus,
      'aguardando_retirada',
    );
    assert.equal(
      resolveAdvanceTarget(stages, { status: 'aguardando_retirada', order_type: 'retirada' }).targetStatus,
      'finalizado',
    );
    // Mesa preserva a navegação atual por stages (não pula saiu_entrega).
    assert.equal(
      resolveAdvanceTarget(stages, { status: 'em_preparo', order_type: 'mesa' }).targetStatus,
      'aguardando_retirada',
    );
    assert.equal(
      resolveAdvanceTarget(stages, { status: 'aguardando_retirada', order_type: 'mesa' }).targetStatus,
      'saiu_entrega',
    );
    assert.equal(resolveAdvanceTarget(stages, { status: 'finalizado' }), null);
    assert.equal(resolveAdvanceTarget(stages, { status: 'cancelado' }), null);
  });

  it('regresso: uma casa, delivery simétrico, terminais sem regresso', () => {
    const stages = mapped(seedRows());
    assert.equal(resolveRegressTarget(stages, { status: 'em_preparo', order_type: 'mesa' }).targetStatus, 'confirmado');
    assert.equal(
      resolveRegressTarget(stages, { status: 'saiu_entrega', order_type: 'delivery' }).targetStatus,
      'em_preparo',
    );
    assert.equal(resolveRegressTarget(stages, { status: 'novo' }), null);
    assert.equal(resolveRegressTarget(stages, { status: 'finalizado' }), null);
  });

  it('stages customizadas: mesma mapsTo é pulada (uma transição legada)', () => {
    const stages = [
      { id: 'a', key: 'novo', mapsTo: 'novo', name: 'Novo', color: '#3b82f6', position: 0, active: true },
      { id: 'b', key: 'prod-1', mapsTo: 'em_preparo', name: 'Produção', color: '#f97316', position: 1, active: true },
      { id: 'c', key: 'em_preparo', mapsTo: 'em_preparo', name: 'Em preparo', color: '#f97316', position: 2, active: true },
      { id: 'd', key: 'finalizado', mapsTo: 'finalizado', name: 'Finalizado', color: '#22c55e', position: 3, active: true },
    ];
    assert.equal(resolveAdvanceTarget(stages, { status: 'novo' }).targetStage.key, 'prod-1');
    assert.equal(resolveAdvanceTarget(stages, { status: 'em_preparo' }).targetStatus, 'finalizado');
    assert.equal(resolveRegressTarget(stages, { status: 'em_preparo' }).targetStatus, 'novo');
  });

  it('assertSingleStep: noop, cancel legado, avanço/recuo ok, pulo rejeitado', () => {
    const stages = mapped(seedRows());
    assert.deepEqual(assertSingleStep(stages, 'novo', 'novo'), { noop: true });
    assert.deepEqual(assertSingleStep(stages, 'novo', 'cancelado'), { cancel: true });
    assert.equal(assertSingleStep(stages, 'novo', 'confirmado').direction, 'advance');
    assert.equal(assertSingleStep(stages, 'em_preparo', 'confirmado', 'mesa').direction, 'regress');
    // Retirada vai direto de "Pronto" para "Finalizado" (sem etapa de entrega).
    assert.equal(assertSingleStep(stages, 'aguardando_retirada', 'finalizado', 'retirada').direction, 'advance');
    // Delivery mantém a baixa a partir de saiu_entrega.
    assert.equal(assertSingleStep(stages, 'saiu_entrega', 'finalizado', 'delivery').direction, 'advance');
    assert.throws(() => assertSingleStep(stages, 'novo', 'em_preparo'), /uma etapa/);
    assert.throws(() => assertSingleStep(stages, 'em_preparo', 'novo', 'mesa'), /uma etapa/);
    assert.throws(() => assertSingleStep(stages, 'novo', 'finalizado'), /uma etapa/);
  });

  it('shouldAutoCloseOnAction: concluiu -> fecha; demais -> fica', () => {
    assert.equal(shouldAutoCloseOnAction('accept'), true);
    assert.equal(shouldAutoCloseOnAction('advance'), true);
    assert.equal(shouldAutoCloseOnAction('regress'), true);
    assert.equal(shouldAutoCloseOnAction('cancel'), false);
    assert.equal(shouldAutoCloseOnAction('edit'), false);
  });
});

describe('orderStages — colunas terminais e ação garantida (Kanban)', () => {
  // Cenário real: empresa com finalizado/cancelado/aguardando inativos.
  const samuelLike = () => mapped(seedRows()).map((s) => (
    ['aguardando_retirada', 'finalizado', 'cancelado'].includes(s.key)
      ? { ...s, active: false }
      : s
  ));

  it('displayStages mantém terminais mesmo inativos (sem duplicar)', () => {
    const cols = displayStages(samuelLike());
    const keys = cols.map((s) => s.key);
    assert.ok(keys.includes('finalizado'));
    assert.ok(keys.includes('cancelado'));
    assert.ok(!keys.includes('aguardando_retirada'));
    assert.equal(new Set(cols.map((s) => s.id)).size, cols.length);
    assert.deepEqual(displayStages(mapped(seedRows())).map((s) => s.key), [
      'novo', 'confirmado', 'em_preparo', 'aguardando_retirada',
      'saiu_entrega', 'finalizado', 'cancelado',
    ]);
  });

  it('resolveCardPrimary: configurada quando há alvo; fallback legado senão', () => {
    const full = mapped(seedRows());
    assert.deepEqual(
      resolveCardPrimary(full, { status: 'novo' }),
      { id: 'accept', label: 'Aceitar', next: 'confirmado', fallback: false },
    );
    assert.equal(
      resolveCardPrimary(full, { status: 'saiu_entrega', order_type: 'delivery' }).next,
      'finalizado',
    );
    // Sem alvo configurado (finalizado inativo): fallback mostra a baixa.
    const stuck = samuelLike();
    assert.equal(resolveAdvanceTarget(stuck, { status: 'saiu_entrega', order_type: 'delivery' }), null);
    assert.deepEqual(
      resolveCardPrimary(stuck, { status: 'saiu_entrega', order_type: 'delivery' }),
      { id: 'advance', label: '→ Finalizado', next: 'finalizado', fallback: true },
    );
    // Retirada/mesa presas em saiu_entrega (finalizado inativo) também
    // precisam da baixa legada, senão o modal fica sem ação de finalizar.
    for (const order_type of ['retirada', 'mesa']) {
      assert.equal(resolveAdvanceTarget(stuck, { status: 'saiu_entrega', order_type }), null);
      const fallback = resolveCardPrimary(stuck, { status: 'saiu_entrega', order_type });
      assert.equal(fallback.next, 'finalizado');
      assert.equal(fallback.fallback, true);
    }
    // Terminais e status desconhecido nunca têm ação.
    assert.equal(resolveCardPrimary(full, { status: 'finalizado' }), null);
    assert.equal(resolveCardPrimary(full, { status: 'cancelado' }), null);
  });

  it('assertSingleStep: baixa terminal passa quando é o próximo legado', () => {
    const stuck = samuelLike();
    assert.equal(
      assertSingleStep(stuck, 'saiu_entrega', 'finalizado', 'delivery').direction,
      'advance',
    );
    assert.equal(
      assertSingleStep(stuck, 'aguardando_retirada', 'finalizado', 'mesa').direction,
      'advance',
    );
    // Pulo continua rejeitado mesmo com terminal no destino.
    assert.throws(() => assertSingleStep(stuck, 'novo', 'finalizado', 'delivery'), /uma etapa/);
    assert.throws(() => assertSingleStep(stuck, 'confirmado', 'finalizado', 'mesa'), /uma etapa/);
  });

  it('pedido novo sem etapa seguinte visível: sem ação (nunca transição invisível)', () => {
    // Só Novo ativa: o alvo legado (confirmado) não tem coluna própria.
    const onlyNovo = mapped(seedRows()).map((s) => (
      s.key === 'novo' ? s : { ...s, active: false }
    ));
    assert.equal(resolveAdvanceTarget(onlyNovo, { status: 'novo' }), null);
    assert.equal(resolveCardPrimary(onlyNovo, { status: 'novo' }), null);
  });

  it('aceite respeita a próxima etapa ativa (pula Confirmado inativo)', () => {
    const semConfirmado = mapped(seedRows()).map((s) => (
      s.key === 'confirmado' ? { ...s, active: false } : s
    ));
    assert.deepEqual(
      resolveCardPrimary(semConfirmado, { status: 'novo' }),
      { id: 'accept', label: 'Aceitar', next: 'em_preparo', fallback: false },
    );
  });

  it('sem Pronto ativo: todos os tipos avançam de Em preparo para Saiu', () => {
    const stages = samuelLike();
    const cols = displayStages(stages);
    assert.equal(stageForStatus(cols, 'saiu_entrega').mapsTo, 'saiu_entrega');
    for (const order_type of ['delivery', 'retirada', 'mesa']) {
      assert.equal(
        resolveAdvanceTarget(stages, { status: 'em_preparo', order_type }).targetStatus,
        'saiu_entrega',
      );
      assert.deepEqual(
        resolveCardPrimary(stages, { status: 'em_preparo', order_type }),
        { id: 'advance', label: '→ Saiu p/ entrega', next: 'saiu_entrega', fallback: false },
      );
      assert.equal(
        assertSingleStep(stages, 'em_preparo', 'saiu_entrega', order_type).direction,
        'advance',
      );
    }
    // Com Pronto ativo, retirada continua sem passar por Saiu.
    assert.throws(
      () => assertSingleStep(mapped(seedRows()), 'em_preparo', 'saiu_entrega', 'retirada'),
      /uma etapa/,
    );
  });

  it('sem Pronto e sem Saiu ativos: não inventa destino sem coluna', () => {
    const stages = samuelLike().map((s) => (
      s.key === 'saiu_entrega' ? { ...s, active: false } : s
    ));
    for (const order_type of ['delivery', 'retirada', 'mesa']) {
      assert.equal(resolveAdvanceTarget(stages, { status: 'em_preparo', order_type }), null);
      assert.equal(
        resolveCardPrimary(stages, { status: 'em_preparo', order_type }),
        null,
      );
    }
  });

  it('status desconhecido: na primeira coluna, sem inventar transição', () => {
    const full = mapped(seedRows());
    assert.equal(stageForStatus(full, 'arquivado').key, 'novo');
    // Sem ação (card exibe diagnóstico); nunca avança para status arbitrário.
    assert.equal(resolveCardPrimary(full, { status: 'arquivado' }), null);
  });

  it('realtime/recarga: colunas determinísticas entre carregamentos', () => {
    const samuelA = samuelLike();
    // Simula recarga: objetos novos, mesmo conteúdo (como após refresh/realtime).
    const samuelB = samuelLike();
    const keysA = displayStages(samuelA).map((s) => `${s.key}:${s.active !== false ? 1 : 0}`);
    const keysB = displayStages(samuelB).map((s) => `${s.key}:${s.active !== false ? 1 : 0}`);
    assert.deepEqual(keysA, keysB);
    // Terminais sempre presentes como coluna (mesmo inativos).
    assert.ok(keysA.some((k) => k.startsWith('finalizado')));
    assert.ok(keysA.some((k) => k.startsWith('cancelado')));
    // Pedido terminal mapeia para a própria coluna (nunca Novo).
    assert.equal(stageForStatus(displayStages(samuelA), 'finalizado').mapsTo, 'finalizado');
    assert.equal(stageForStatus(displayStages(samuelA), 'cancelado').mapsTo, 'cancelado');
  });

  it('terminal nunca tem ação; saiu_entrega mira a baixa', () => {
    const full = mapped(seedRows());
    assert.equal(resolveCardPrimary(full, { status: 'finalizado' }), null);
    assert.equal(resolveCardPrimary(full, { status: 'cancelado' }), null);
    const baixa = resolveCardPrimary(full, { status: 'saiu_entrega', order_type: 'delivery' });
    assert.equal(baixa.next, 'finalizado');
    assert.equal(baixa.fallback, false);
  });
});

describe('orderStages — escrita via adapter (RLS no banco)', () => {
  const supaRow = (status) => ({
    id: 'o1', company_id: 'c1', order_number: 1, status, subtotal: 0,
    customer_data: {}, delivery_address: {}, created_at: 't',
  });

  it('advance/regress chamam manage_order com o status mapeado', async () => {
    const stages = mapped(seedRows());
    const client = createStagesMock({ rpcRow: supaRow('confirmado') });
    const out = await advanceOrder(client, stages, { id: 'o1', status: 'novo', order_type: 'mesa' });
    assert.equal(out.status, 'confirmado');
    assert.deepEqual(client.calls.rpc[0], {
      fn: 'manage_order',
      args: { p_order_id: 'o1', p_action: 'status', p_status: 'confirmado' },
    });
    const back = await regressOrder(
      createStagesMock({ rpcRow: supaRow('confirmado') }),
      stages,
      { id: 'o1', status: 'em_preparo', order_type: 'mesa' },
    );
    assert.equal(back.status, 'confirmado');
  });

  it('etapa final/inicial lança antes da rede (rollback natural)', async () => {
    const stages = mapped(seedRows());
    const client = createStagesMock({ rpcRow: supaRow('finalizado') });
    await assert.rejects(() => advanceOrder(client, stages, { id: 'o1', status: 'finalizado' }), /etapa final/);
    await assert.rejects(() => regressOrder(client, stages, { id: 'o1', status: 'novo' }), /etapa inicial/);
    assert.equal(client.calls.rpc.length, 0);
  });

  it('createStage valida sem rede; insere com key slug + posição seguinte', async () => {
    const client = createStagesMock();
    await assert.rejects(() => createStage(client, 'c1', { name: ' ', mapsTo: 'em_preparo' }), /obrigatório/);
    await assert.rejects(() => createStage(client, 'c1', { name: 'X', color: 'red', mapsTo: 'em_preparo' }), /Cor/);
    await assert.rejects(() => createStage(client, 'c1', { name: 'X', mapsTo: 'cancelado' }), /exceto cancelado/);
    const created = await createStage(client, 'c1', { name: 'Produção', color: '#f97316', mapsTo: 'em_preparo' });
    assert.equal(created.mapsTo, 'em_preparo');
    const payload = client.calls.insert[0].payload;
    assert.equal(payload.company_id, 'c1');
    assert.ok(payload.stage_key.startsWith('producao-'));
    assert.equal(payload.sort_order, 7);
  });

  it('updateStage valida e nunca envia company_id', async () => {
    const client = createStagesMock();
    const out = await updateStage(client, 'c1', 'st-novo', { name: 'Recebido', color: '#111111' });
    assert.equal(out.name, 'Recebido');
    const payload = client.calls.update[0].payload;
    assert.ok(!('company_id' in payload) && !('stage_key' in payload));
    await assert.rejects(() => updateStage(client, 'c1', 'missing', { name: 'X' }), /sem permissão/);
  });

  it('deleteStage: última trava; com irmã libera; sem irmã + pedidos trava', async () => {
    const solo = createStagesMock({ stages: [seedRows()[0]] });
    await assert.rejects(() => deleteStage(solo, 'c1', 'st-novo'), /última etapa/);

    const withSibling = createStagesMock({
      stages: [...seedRows(), { ...seedRows()[2], id: 'st-extra', stage_key: 'prod-x' }],
      ordersInStatus: { em_preparo: true },
    });
    assert.equal(await deleteStage(withSibling, 'c1', 'st-extra'), true);
    assert.equal(withSibling.calls.delete.length, 1);

    const noSiblingOrders = createStagesMock({ ordersInStatus: { em_preparo: true } });
    await assert.rejects(() => deleteStage(noSiblingOrders, 'c1', 'st-em_preparo'), /outra etapa/);
    assert.equal(noSiblingOrders.calls.delete.length, 0);

    const noSiblingEmpty = createStagesMock({ ordersInStatus: {} });
    assert.equal(await deleteStage(noSiblingEmpty, 'c1', 'st-em_preparo'), true);
  });

  it('setStageActive: com irmã visível libera; sem irmã + pedidos trava', async () => {
    const withSibling = createStagesMock({
      stages: [...seedRows(), { ...seedRows()[2], id: 'st-extra', stage_key: 'prod-x' }],
      ordersInStatus: { em_preparo: true },
    });
    const out = await setStageActive(withSibling, 'c1', 'st-em_preparo', false);
    assert.equal(out.active, false);

    const blocked = createStagesMock({ ordersInStatus: { em_preparo: true } });
    await assert.rejects(() => setStageActive(blocked, 'c1', 'st-em_preparo', false), /outra etapa visível/);

    const empty = createStagesMock({ ordersInStatus: {} });
    assert.equal((await setStageActive(empty, 'c1', 'st-em_preparo', false)).active, false);
  });

  it('setStageActive: terminal com histórico desativa; operacional com pedido trava', async () => {
    // A. Cancelado/Finalizado com pedidos históricos → PODE desativar (sem irmã)
    const hist = createStagesMock({ ordersInStatus: { cancelado: true, finalizado: true } });
    assert.equal((await setStageActive(hist, 'c1', 'st-cancelado', false)).active, false);
    assert.equal((await setStageActive(hist, 'c1', 'st-finalizado', false)).active, false);

    // B. Etapa operacional com pedido ativo e sem irmã → CONTINUA bloqueada
    const blocked = createStagesMock({ ordersInStatus: { em_preparo: true } });
    await assert.rejects(() => setStageActive(blocked, 'c1', 'st-em_preparo', false), /outra etapa visível/);

    // C. Desativar não escreve em orders (só na tabela de stages)
    assert.ok(hist.calls.update.length > 0);
    assert.ok(hist.calls.update.every((u) => u.table === 'restaurant_order_stages'));
    assert.equal(hist.calls.delete.length, 0);
    assert.equal(hist.calls.insert.length, 0);

    // D. Reativar restaura a coluna natural do status
    const back = await setStageActive(hist, 'c1', 'st-cancelado', true);
    assert.equal(back.active, true);
    const reloaded = await listStages(hist, 'c1');
    assert.equal(stageForStatus(reloaded, 'cancelado').key, 'cancelado');
  });

  it('E. financeiro conta finalizados/cancelados independente das stages', async () => {
    const { summarizeOrders } = await import('../lib/finance.js');
    const s = summarizeOrders([
      { status: 'finalizado', total: 100, order_type: 'delivery', payment_method: 'Pix' },
      { status: 'cancelado', total: 50, order_type: 'mesa' },
      { status: 'novo', total: 30, order_type: 'delivery' },
    ]);
    assert.equal(s.revenue, 100);
    assert.equal(s.paidCount, 1);
    assert.equal(s.canceledCount, 1);
    assert.equal(s.byStatus.finalizado.count, 1);
    assert.equal(s.byStatus.cancelado.count, 1);
  });

  it('reorderStages: divergência trava; válido regrava posições', async () => {
    const client = createStagesMock();
    const ids = seedRows().map((r) => r.id);
    await assert.rejects(() => reorderStages(client, 'c1', ids.slice(0, 3)), /divergência/);
    await assert.rejects(() => reorderStages(client, 'c1', [...ids, 'st-outra']), /divergência/);
    const reversed = [...ids].reverse();
    const out = await reorderStages(client, 'c1', reversed);
    assert.equal(out.length, 7);
    assert.equal(client.calls.update.length, 7);
    assert.deepEqual(client.calls.update[0].payload, { sort_order: 0 });
  });

  it('listStages exige empresa (falha antes da rede)', async () => {
    await assert.rejects(() => listStages(createStagesMock(), null), /Empresa atual/);
  });

  it('TERMINAL_MAPS_TO preserva financeiro/fila (finalizado/cancelado)', () => {
    assert.ok(TERMINAL_MAPS_TO.includes('finalizado'));
    assert.ok(TERMINAL_MAPS_TO.includes('cancelado'));
  });
});
