// Бригада на месте (срез, часть С4; docs/08-game-design.md, §5): общепрофильная просит реанимационную — только по записи
// `resus` с источником и параметрам болезни (388н, прил. 2, п. 17); ответ — послать реанимационную или «пусть везут
// сами»; не ответили — везут сами; свободная реанимационная была, а её не послали, — ошибка в разборе. Станция: реанимобиль
// — обученная бригада выходит реанимационной.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import type { Db } from '../../src/content/types';
import { FAR } from '../../src/engine/road/route';
import { review } from '../../src/engine/review';
import { ASK_AFTER } from '../../src/engine/rules';
import { advance, apply, asking, nextEvent, newShift, type Shift, type ShiftCtx, shiftCtx } from '../../src/engine/shift';
import { afterShift, decide, lineupOf, newStation, RESUS_PRICE, type ShiftReport, type Station } from '../../src/engine/station';
import { loadMap } from '../../src/map/load';
import { stationView } from '../../src/state/stationView';
import { weekShifts } from '../../src/state/week';
import { BOTS, botMove, play } from '../sim/bots';

const map = loadMap(DB.cities['city.proto'].map);
const week = weekShifts();

/** База, где каждому больному нужна реанимационная, — проверить механику, не числа записей. */
function allResus(db: Db): Db {
  const conditions = Object.fromEntries(Object.entries(db.phone.conditions).map(([id, c]) => [id, { ...c, fatal: undefined, resus: { when: {}, source: c.sources[0] } }]));
  return { ...db, phone: { ...db.phone, conditions } };
}

/** Играть ботом, но на просьбу о реанимационной отвечать «пусть везут сами». */
function playOwn(ctx: ShiftCtx, seed: number): Shift {
  const s = newShift(ctx, seed);
  for (let i = 0; i < 20000 && !s.over; i++) {
    const ask = s.calls.find(c => asking(c) === 'resus');
    const cmd = ask ? { c: 'second' as const, call: ask.id } : botMove(ctx, s, BOTS.rules);
    if (cmd) expect(apply(ctx, s, cmd)).toBeNull();
    else {
      const next = nextEvent(ctx, s);
      advance(ctx, s, next === FAR ? 60_000 : Math.max(1, next - s.t));
    }
  }
  expect(s.over).toBe(true);
  return s;
}

describe('бригада на месте', () => {
  test('просьба о реанимационной — только по записи `resus` с источником; в записях недели — две', () => {
    const with_ = Object.values(DB.phone.conditions).filter(c => c.resus);
    expect(with_.map(c => c.id).sort()).toEqual(['cond.acs', 'cond.asthma_exacerbation']);
    for (const c of with_) {
      expect(c.sources).toContain(c.resus!.source);
      expect(Object.keys(c.resus!.when).length).toBeGreaterThan(0);
    }
    // без `resus` общепрофильная не просит
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    const { s } = play(ctx, 3, BOTS.rules);
    for (const c of s.calls) if (c.second) expect(DB.phone.conditions[c.truth.condition].resus).toBeDefined();
  });

  test('общепрофильная просит через ASK_AFTER; послали реанимационную — она приезжает и ведёт вызов, первая свободна', () => {
    const ctx = shiftCtx(allResus(DB), MED, week[1].id, map);
    const { s } = play(ctx, 5, BOTS.rules);
    const sent = s.calls.filter(c => c.second?.answer === 'sent');
    expect(sent.length).toBeGreaterThan(0);
    for (const c of sent) {
      const sc = c.second!;
      expect(sc.at).toBe(c.arrivedAt! + ASK_AFTER);
      expect(sc.came).not.toBeNull();
      expect(c.crew).toBe(sc.crew);
      expect(s.crews.find(x => x.id === sc.crew)!.kind).toBe('crew.resus');
      expect(s.crews.find(x => x.id === sc.by)!.call).not.toBe(c.id);
    }
    // реанимационная сама не просит; разбор не считает её «реанимационной на неотложный»
    for (const c of s.calls) if (c.second) expect(s.crews.find(x => x.id === c.second!.by)!.kind).toBe('crew.general');
    for (const r of review(ctx, s).calls) for (const m of r.mistakes) if (m.m.kind === 'crew') expect(s.calls.find(c => c.id === r.id)!.second?.answer).not.toBe('sent');
  });

  test('«пусть везут сами», когда свободная реанимационная была, — ошибка в разборе и исход «с опозданием»', () => {
    const ctx = shiftCtx(allResus(DB), MED, week[1].id, map);
    const s = playOwn(ctx, 7);
    const own = s.calls.filter(c => c.second?.answer === 'own');
    expect(own.length).toBeGreaterThan(0);
    const r = review(ctx, s);
    for (const c of own) {
      const cr = r.calls.find(x => x.id === c.id)!;
      expect(cr.outcome.tier === 'late' || cr.outcome.tier === 'died').toBe(true);
      expect(cr.mistakes.some(m => m.m.kind === 'noSecond')).toBe(c.second!.free);
    }
    expect(own.some(c => c.second!.free)).toBe(true);
  });

  test('станция: реанимобиль — обученная бригада выходит реанимационной; гараж — на две машины класса C', () => {
    const rep: ShiftReport = { shift: week[0].id, emergency: 4, inNorm: 4, longWaits: 0, refusals: 0, costly: 0, deaths: 0, inquiries: [], kits: {} };
    let st: Station = { ...afterShift(newStation(), rep), fund: 3 * RESUS_PRICE };
    const v = stationView(st);
    expect(v.resus.map(c => c.crewNo)).toEqual([1, 4]);
    st = decide(st, { d: 'resus', crew: 'crew.1' }) as Station;
    expect(st.trained).toEqual(['crew.1']);
    expect(decide(st, { d: 'resus', crew: 'crew.1' })).toBe('trained');
    const s = newShift(shiftCtx(DB, MED, week[1].id, map), 1, lineupOf(st));
    expect(s.crews.find(c => c.id === 'crew.1')!.kind).toBe('crew.resus');
    expect(stationView(st).next!.roster.find(r => r.no === 1)!.kind).toBe(DB.crews['crew.resus'].name);
    st = decide(st, { d: 'resus', crew: 'crew.4' }) as Station;
    expect(decide({ ...st, decided: 0 }, { d: 'resus', crew: 'crew.2' })).toBe('garage');
  });
});
