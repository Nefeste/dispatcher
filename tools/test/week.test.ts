// «Первая неделя» (срез, часть С1; docs/08-game-design.md, §8): семь смен по порядку, следующая открывается после
// предыдущей с любым итогом; каждая смена проходится ботом «по правилам» до конца, в её часы и с её бригадами.
import { expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { shiftCtx } from '../../src/engine/shift';
import { totals } from '../../src/engine/totals';
import { loadMap } from '../../src/map/load';
import type { Best } from '../../src/state/progress';
import { weekRows, weekShifts } from '../../src/state/week';
import { BOTS, play } from '../sim/bots';

const map = loadMap(DB.cities['city.proto'].map);
const any: Best = { emergency: 3, inNorm: 1, urgentMedian: null, accepted: 10 };

test('семь смен по номеру; первая — с учебными звонками, остальные — без', () => {
  const w = weekShifts();
  expect(w.map(s => s.week!.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(w[0].script.length).toBe(3);
  for (const s of w.slice(1)) expect(s.script.length).toBe(0);
  // седьмая — длинная (§9 геймдизайна: 4 часа), остальные — по 2
  expect(w.map(s => s.length / 3600)).toEqual([2, 2, 2, 2, 2, 2, 4]);
});

test('следующая открывается после предыдущей — с любым итогом', () => {
  const w = weekShifts();
  expect(weekRows({}).map(r => r.open)).toEqual([true, false, false, false, false, false, false]);
  const after2 = weekRows({ [w[0].id]: any, [w[1].id]: { ...any, inNorm: 0 } });
  expect(after2.map(r => r.open)).toEqual([true, true, true, false, false, false, false]);
  expect(after2[0].best).toEqual(any);
  // ночная смена за полночь: конец — больше суток, часы на экране — по модулю
  expect(weekRows({})[6].to).toBe(w[6].start + w[6].length);
});

test('каждая смена недели проходится «по правилам» до конца', () => {
  for (const sh of weekShifts()) {
    const ctx = shiftCtx(DB, MED, sh.id, map);
    const { s } = play(ctx, 7, BOTS.rules);
    const t = totals(ctx, s);
    expect(s.over).toBe(true);
    expect(t.accepted).toBeGreaterThan(4);
    // больницы смены — её часть больниц города
    if (sh.hospitals) expect(ctx.city.hospitals.map(h => h.id)).toEqual(sh.hospitals);
    for (const c of s.calls) if (c.hospital) expect(ctx.city.hospitals.some(h => h.id === c.hospital)).toBe(true);
  }
});
