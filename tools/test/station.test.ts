// Станция между сменами (срез, часть С2; docs/08-game-design.md, §15): фонд из итогов, письмо, решения — не больше трёх
// за перерыв; станция знает только итог смены; её бригады и укладки выходят на следующую смену; та же цепочка итогов и
// решений — та же станция (золотая неделя — часть С8, здесь — повторяемость).
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { free } from '../../src/engine/crews';
import { KIT, KIT_PLUS, RESTOCK, RESTOCK_FAST } from '../../src/engine/rules';
import { newShift, shiftCtx } from '../../src/engine/shift';
import { afterShift, canDecide, capFor, CREW_PRICE, decide, EXTRA_IDS, lineupOf, missingOf, newStation, priceOf, reportOf, type ShiftReport, STATION, type Station } from '../../src/engine/station';
import { totals } from '../../src/engine/totals';
import { loadMap } from '../../src/map/load';
import { parseStation } from '../../src/state/station';
import { stationView } from '../../src/state/stationView';
import { weekShifts } from '../../src/state/week';
import { BOTS, play } from '../sim/bots';
import { runWeek } from '../sim/week';

const map = loadMap(DB.cities['city.proto'].map);
const week = weekShifts();
const rep = (over: Partial<ShiftReport> = {}): ShiftReport => ({ shift: week[0].id, emergency: 5, inNorm: 4, longWaits: 0, refusals: 0, costly: 0, deaths: 0, inquiries: [], kits: {}, ...over });
const ok = (x: Station | string): Station => {
  if (typeof x === 'string') throw new Error(x);
  return x;
};

describe('станция', () => {
  test('бригады недели — бригады станции: у номера всю неделю тот же вид и подстанция; номера станции свободны', () => {
    const seen = new Map<string, string>();
    for (const sh of week) {
      for (const c of sh.crews) {
        const what = `${c.kind}@${c.base}`;
        expect(seen.get(c.id) ?? what).toBe(what);
        seen.set(c.id, what);
        expect(EXTRA_IDS as readonly string[]).not.toContain(c.id);
      }
    }
  });

  test('итог смены: доход, благодарность, жалобы; повтор той же смены станцию не меняет', () => {
    let st = afterShift(newStation(), rep());
    expect(st.fund).toBe(STATION.perShift + 4 * STATION.perInNorm + STATION.thanks);
    expect(st.letter).toMatchObject({ after: week[0].id, thanks: true, income: STATION.perShift + 4 * STATION.perInNorm });
    expect(afterShift(st, rep({ inNorm: 5 }))).toBe(st);
    st = afterShift(st, rep({ shift: week[1].id, inNorm: 0, costly: 2, longWaits: 1, refusals: 1 }));
    expect(st.fund).toBe(2 * STATION.perShift + 4 * STATION.perInNorm + STATION.thanks - 2 * STATION.complaint);
    expect(st.letter?.thanks).toBe(false);
    expect(st.journal.filter(e => e.kind === 'complaint')).toHaveLength(2);
    expect(st.done).toEqual([week[0].id, week[1].id]);
  });

  test('решения: до первой смены нельзя; не больше трёх; фонд; гараж; полные укладки', () => {
    expect(canDecide(newStation(), { d: 'kits', crews: ['crew.1'] })).toBe('noShift');
    let st: Station = { ...afterShift(newStation(), rep({ kits: { 'crew.1': 1 } })), fund: 2 * CREW_PRICE + 3 * STATION.kitCall };
    expect(st.kits).toEqual({ 'crew.1': 1 });
    // заказ — на выбранные бригады, цена — за каждый вызов до полной
    expect(priceOf({ d: 'kits', crews: ['crew.1'] }, st)).toBe(3 * STATION.kitCall);
    expect(canDecide(st, { d: 'kits', crews: [] })).toBe('none');
    expect(canDecide(st, { d: 'kits', crews: ['crew.2'] })).toBe('none');
    st = ok(decide(st, { d: 'kits', crews: ['crew.1'] }));
    expect(st.kits).toEqual({});
    expect(st.journal.at(-1)).toMatchObject({ kind: 'kits', amount: -3 * STATION.kitCall, crews: ['crew.1'] });
    expect(canDecide(st, { d: 'kits', crews: ['crew.1'] })).toBe('full');
    st = ok(decide(st, { d: 'crew', base: 'base.south' }));
    expect(st.extra).toEqual([{ id: 'crew.7', kind: 'crew.general', base: 'base.south' }]);
    st = ok(decide(st, { d: 'crew', base: 'base.north' }));
    expect(st.fund).toBe(0);
    expect(canDecide(st, { d: 'crew', base: 'base.north' })).toBe('limit');
    // новый перерыв — решения снова; гараж — на две машины
    st = { ...afterShift(st, rep({ shift: week[1].id, kits: { 'crew.7': 0 } })), fund: 10 * CREW_PRICE };
    expect(st.decided).toBe(0);
    expect(canDecide(st, { d: 'crew', base: 'base.north' })).toBe('garage');
    expect(canDecide({ ...st, fund: 0 }, { d: 'kits', crews: ['crew.7'] })).toBe('fund');
    expect(decide({ ...st, fund: 0 }, { d: 'kits', crews: ['crew.7'] })).toBe('fund');
  });

  test('заказ укладок — только выбранным бригадам; остальные переходят на следующую смену неполными', () => {
    let st: Station = { ...afterShift(newStation(), rep({ kits: { 'crew.1': 0, 'crew.2': 3, 'crew.3': 4 } })), fund: 100_000 };
    expect(st.kits).toEqual({ 'crew.1': 0, 'crew.2': 3 });
    st = ok(decide(st, { d: 'kits', crews: ['crew.1'] }));
    expect(st.kits).toEqual({ 'crew.2': 3 });
    expect(st.fund).toBe(100_000 - KIT * STATION.kitCall);
    expect(lineupOf(st).kits).toEqual({ 'crew.2': 3 });
  });

  test('расширенная укладка: бригаде на два вызова больше — сразу и до конца недели; склад — подстанции; повторно — «уже есть»', () => {
    let st: Station = { ...afterShift(newStation(), rep({ kits: { 'crew.1': 1, 'crew.2': 4 } })), fund: 500_000 };
    st = ok(decide(st, { d: 'plus', crew: 'crew.1' }));
    expect(st.plus).toEqual(['crew.1']);
    expect(capFor(st, 'crew.1')).toBe(KIT + KIT_PLUS);
    expect(st.kits['crew.1']).toBe(1 + KIT_PLUS);
    expect(canDecide(st, { d: 'plus', crew: 'crew.1' })).toBe('has');
    expect(missingOf(st, 'crew.1')).toBe(KIT + KIT_PLUS - 1 - KIT_PLUS);
    st = ok(decide(st, { d: 'stock', base: 'base.north' }));
    expect(st.stock).toEqual(['base.north']);
    expect(canDecide(st, { d: 'stock', base: 'base.north' })).toBe('has');
    expect(st.fund).toBe(500_000 - STATION.plus - STATION.stock);
    expect(lineupOf(st)).toMatchObject({ plus: ['crew.1'], stock: ['base.north'] });
    // полная укладка бригады с расширенной — шесть вызовов: после смены с шестью её нет в списке неполных
    st = afterShift(st, rep({ shift: week[1].id, kits: { 'crew.1': KIT + KIT_PLUS, 'crew.2': KIT } }));
    expect(st.kits).toEqual({});
  });

  test('смена с закупками: полная укладка — шесть, пополнение на подстанции со складом — 10 минут', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    const crew = ctx.setup.crews[0];
    const s = newShift(ctx, 7, { extra: [], kits: { [crew.id]: 0 }, trained: [], plus: [crew.id], stock: [crew.base] });
    const c = s.crews.find(x => x.id === crew.id)!;
    expect(c.cap).toBe(KIT + KIT_PLUS);
    expect(c.state).toBe('restock');
    expect(c.until).toBe(RESTOCK_FAST);
    const other = s.crews.find(x => x.id !== crew.id)!;
    expect(other.cap).toBeUndefined();
    expect(other.restockMs ?? RESTOCK).toBe(other.base === c.base ? RESTOCK_FAST : RESTOCK);
  });

  test('итог смены для станции — из итога и разбора; укладки бригад в конце смены', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    const { s } = play(ctx, 5, BOTS.rules);
    const r = reportOf(ctx, s);
    const t = totals(ctx, s);
    expect([r.emergency, r.inNorm]).toEqual([t.emergency, t.inNorm]);
    expect(Object.keys(r.kits).sort()).toEqual(s.crews.map(c => c.id).sort());
    for (const n of Object.values(r.kits)) expect(n).toBeLessThanOrEqual(KIT);
  });

  test('станция выводит свои бригады на следующую смену и передаёт укладки; пустая — смена с пополнения', () => {
    const ctx = shiftCtx(DB, MED, week[2].id, map);
    const st: Station = { ...newStation(), extra: [{ id: 'crew.7', kind: 'crew.general', base: 'base.south' }], kits: { 'crew.1': 0, 'crew.2': 2 } };
    const s = newShift(ctx, 3, lineupOf(st));
    expect(s.crews.map(c => c.id)).toEqual([...week[2].crews.map(c => c.id), 'crew.7']);
    const c7 = s.crews.find(c => c.id === 'crew.7')!;
    expect(c7.base).toBe(ctx.city.bases.find(b => b.id === 'base.south')!.node);
    expect(free(c7)).toBe(true);
    const c1 = s.crews.find(c => c.id === 'crew.1')!;
    expect([c1.state, free(c1)]).toEqual(['restock', false]);
    expect(s.crews.find(c => c.id === 'crew.2')!.kit).toBe(2);
    // бригады станции выходят на вызовы
    const { s: played } = play(ctx, 3, BOTS.rules, lineupOf(st));
    expect(played.calls.some(c => c.crew === 'crew.7')).toBe(true);
  });

  test('неделя переигрывается в ту же станцию', () => {
    const a = runWeek(2, 'rules', 'best');
    const b = runWeek(2, 'rules', 'best');
    expect(JSON.stringify(b.st)).toBe(JSON.stringify(a.st));
    expect(a.st.done).toHaveLength(7);
    expect(a.decisions).toBeGreaterThan(0);
  });

  test('вид станции: следующая смена, табель с бригадами станции, что можно решить', () => {
    expect(stationView(newStation()).next?.n).toBe(1);
    let st = { ...afterShift(newStation(), rep({ kits: { 'crew.4': 3 } })), fund: CREW_PRICE };
    st = ok(decide(st, { d: 'crew', base: 'base.north' }));
    const v = stationView(st);
    expect(v.next?.n).toBe(2);
    expect(v.letter?.n).toBe(1);
    expect(v.left).toBe(2);
    expect(v.next?.roster.at(-1)).toMatchObject({ no: 7, own: true, kit: KIT });
    expect(v.short.map(r => [r.no, r.kit])).toEqual([[4, 3]]);
    expect(v.crew.map(c => c.no)).toEqual(['fund', 'fund']);
    expect(v.journal[0]).toMatchObject({ kind: 'crew', no: 7, amount: -CREW_PRICE });
  });

  test('хранилище: чужая форма — станция с начала недели; знакомые поля — как были', () => {
    expect(parseStation('{"fund":"x"}')).toEqual(newStation());
    expect(parseStation('не json')).toEqual(newStation());
    const st = { ...afterShift(newStation(), rep({ kits: { 'crew.1': 2 } })), extra: [{ id: 'crew.7', kind: 'crew.general' as const, base: 'base.north' }] };
    expect(parseStation(JSON.stringify(st))).toEqual(st);
  });
});
