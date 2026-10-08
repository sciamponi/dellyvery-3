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
  stageForStatus,
  resolveAdvanceTarget,
  resolveRegressTarget,
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

  it('avanço legado preservado: delivery pula aguardando_retirada', () => {
    const stages = mapped(seedRows());
    assert.equal(resolveAdvanceTarget(stages, { status: 'novo', order_type: 'delivery' }).targetStatus, 'confirmado');
    assert.equal(
      resolveAdvanceTarget(stages, { status: 'em_preparo', order_type: 'delivery' }).targetStatus,
      'saiu_entrega',
    );
    assert.equal(
      resolveAdvanceTarget(stages, { status: 'em_preparo', order_type: 'mesa' }).targetStatus,
      'aguardando_retirada',
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
