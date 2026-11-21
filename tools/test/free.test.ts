// «Свободная смена» (docs/08-game-design.md, §8; срез, часть С8в): выбор — в номере смены, запись — из выбора; движок
// играет её как любую смену; открывается, когда у каждой смены недели есть итог.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { shiftCtx } from '../../src/engine/shift';
import { loadMap } from '../../src/map/load';
import { dbFor, FREE, freeId, freeOf, freeOpen, freeSetup, setupOf } from '../../src/state/free';
import { weekShifts } from '../../src/state/week';
import { BOTS, play } from '../sim/bots';

const map = loadMap(DB.cities['city.proto'].map);

describe('свободная смена', () => {
  test('выбор ↔ номер смены; чужой номер или выбор вне границ — не свободная смена', () => {
    for (const hour of [0, 7, 19, 23]) for (const hours of FREE.hours) for (const general of [3, 6]) for (const resus of [0, 1]) {
      const c = { hour, hours, general, resus };
      expect(freeOf(freeId(c))).toEqual(c);
    }
    for (const bad of ['shift.week-1', 'shift.free', 'shift.free.h24.l2.g5.r1', 'shift.free.h19.l3.g5.r1', 'shift.free.h19.l2.g2.r1', 'shift.free.h19.l2.g7.r1', 'shift.free.h19.l2.g5.r2', 'shift.free.h19.l2.g5.r1.x']) {
      expect(freeOf(bad)).toBeNull();
      expect(setupOf(bad)).toBe(DB.shifts[bad] ?? null);
    }
  });

  test('запись: город и время года недели, все больницы, поликлиника в свои часы, без учебных звонков; бригады по подстанциям', () => {
    const s = freeSetup({ hour: 1, hours: 4, general: 5, resus: 1 });
    expect(s.start).toBe(3600);
    expect(s.length).toBe(4 * 3600);
    expect([s.city, s.season, s.hospitals, s.clinic, s.script.length, s.week, s.flowPct]).toEqual([weekShifts()[0].city, weekShifts()[0].season, null, true, 0, null, 100]);
    expect(s.crews.filter(c => c.kind === 'crew.general').length).toBe(5);
    expect(s.crews.filter(c => c.kind === 'crew.resus').length).toBe(1);
    const bases = new Set(DB.cities[s.city].bases.map(b => b.id));
    for (const c of s.crews) {
      expect(bases.has(c.base)).toBe(true);
      expect(DB.crews[c.kind]).toBeDefined();
    }
    // номера бригад — подряд, как в записях недели
    expect(s.crews.map(c => c.id)).toEqual(['crew.1', 'crew.2', 'crew.3', 'crew.4', 'crew.5', 'crew.6']);
  });

  test('движок играет её до конца — днём с поликлиникой и ночью; без реанимационной тоже', () => {
    for (const c of [{ hour: 12, hours: 2, general: 3, resus: 0 }, { hour: 1, hours: 2, general: 6, resus: 1 }]) {
      const id = freeId(c);
      const ctx = shiftCtx(dbFor(id), MED, id, map);
      expect(ctx.setup.id).toBe(id);
      const { s } = play(ctx, 7, BOTS.rules);
      expect(s.over).toBe(true);
      expect(s.calls.length).toBeGreaterThan(5);
      expect(s.crews.length).toBe(c.general + c.resus);
    }
    // запись из содержания база не трогает
    expect(dbFor('shift.week-1')).toBe(DB);
  });

  test('открывается, когда у каждой смены недели есть итог', () => {
    const one = { emergency: 1, inNorm: 1, urgentMedian: null, accepted: 1 };
    const all = Object.fromEntries(weekShifts().map(s => [s.id, one]));
    expect(freeOpen(all)).toBe(true);
    const { [weekShifts()[6].id]: _, ...six } = all;
    expect(freeOpen(six)).toBe(false);
    expect(freeOpen({})).toBe(false);
  });
});
