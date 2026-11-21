// Итог недели (спецификация среза, §3, шаг 9; часть С8): журнал недели — итоги и пути бригад каждой смены, принятой
// станцией, — и итог недели из станции, журнала и лучших итогов. Правды о больных в нём нет (критерий 3 среза).
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { shiftCtx } from '../../src/engine/shift';
import { afterShift, decide, lineupOf, newStation, reportOf, type Station } from '../../src/engine/station';
import { loadMap } from '../../src/map/load';
import { stationView } from '../../src/state/stationView';
import { weekShifts } from '../../src/state/week';
import { weekEnd } from '../../src/state/weekEnd';
import { addEntry, edgesOf, entryOf, newWeekLog, parseWeekLog, pathsOf, type WeekLog } from '../../src/state/weekLog';
import { BOTS, play } from '../sim/bots';
import { policyMoves } from '../sim/week';

const map = loadMap(DB.cities['city.proto'].map);
const week = weekShifts();
const E = map.edges.a.length;

/** Неделя бота «по правилам» с лучшими решениями станции: станция и журнал после каждой смены. */
function playWeek(seed: number): { stations: Station[]; logs: WeekLog[] } {
  let st = newStation();
  let log = newWeekLog(map.id, E);
  const stations: Station[] = [], logs: WeekLog[] = [];
  week.forEach((sh, i) => {
    const ctx = shiftCtx(DB, MED, sh.id, map);
    const { s } = play(ctx, seed * 100 + i + 1, BOTS.rules, lineupOf(st));
    const rep = reportOf(ctx, s);
    st = afterShift(st, rep);
    log = addEntry(log, map.id, E, entryOf(ctx, s, rep));
    for (const d of policyMoves(st, week[i + 1]?.id ?? null, 'best')) {
      const y = decide(st, d);
      if (typeof y !== 'string') st = y;
    }
    stations.push(st);
    logs.push(log);
  });
  return { stations, logs };
}

describe('журнал недели', () => {
  test('пути смены — маской: те же рёбра, по которым ехали бригады, каждое один раз', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    const { s } = play(ctx, 3, BOTS.rules);
    const want = [...new Set(s.trail.flatMap(t => t.edges))].sort((a, b) => a - b);
    expect(want.length).toBeGreaterThan(20);
    const paths = pathsOf(ctx, s);
    expect(paths.length).toBe(Math.ceil(E / 4));
    expect(edgesOf(paths, E)).toEqual(want);
  });

  test('смена в журнале — один раз, как на станции; другая карта — журнал заново; строка хранилища читается обратно', () => {
    const e = { shift: week[0].id, emergency: 3, inNorm: 2, deaths: 0, paths: '0f' };
    const a = addEntry(newWeekLog(map.id, E), map.id, E, e);
    expect(addEntry(a, map.id, E, { ...e, inNorm: 3 })).toBe(a);
    expect(addEntry(a, 'other', 10, e).shifts).toEqual([e]);
    expect(addEntry(a, 'other', 10, e).map).toBe('other');
    expect(parseWeekLog(JSON.stringify(a))).toEqual(a);
    expect(parseWeekLog('не json').shifts).toEqual([]);
    expect(parseWeekLog(JSON.stringify({ map: 'x', edges: 4, shifts: [{ shift: 's', paths: 'zz', emergency: -1 }] })).shifts).toEqual([
      { shift: 's', emergency: 0, inNorm: 0, deaths: 0, paths: '' },
    ]);
  });
});

describe('итог недели', () => {
  const { stations, logs } = playWeek(5);
  const last = stations[stations.length - 1];

  test('открывается, когда станция приняла все семь смен; до того — нет', () => {
    for (let i = 0; i < week.length - 1; i++) {
      expect(weekEnd(stations[i], logs[i], {}).complete).toBe(false);
      expect(stationView(stations[i]).complete).toBe(false);
    }
    expect(weekEnd(last, logs[logs.length - 1], {}).complete).toBe(true);
    expect(stationView(last).complete).toBe(true);
    expect(stationView(last).next).toBeNull();
  });

  test('семь смен — числа их итогов на станции; сумма за неделю; лучший итог — из прогресса', () => {
    const log = logs[logs.length - 1];
    const best = { [week[2].id]: { emergency: 9, inNorm: 9, urgentMedian: 1, accepted: 20 } };
    const v = weekEnd(last, log, best);
    expect(v.rows.map(r => r.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const r of v.rows) {
      const e = log.shifts.find(x => x.shift === r.id)!;
      expect(r.played).toEqual({ emergency: e.emergency, inNorm: e.inNorm, deaths: e.deaths });
    }
    expect(v.rows[2].best).toEqual(best[week[2].id]);
    expect(v.rows[0].best).toBeNull();
    expect(v.total.emergency).toBe(log.shifts.reduce((a, e) => a + e.emergency, 0));
    expect(v.total.inNorm).toBe(log.shifts.reduce((a, e) => a + e.inNorm, 0));
  });

  test('что стало со станцией — из её журнала фонда: заработано, ушло на решения, вычтено; свои бригады', () => {
    const v = weekEnd(last, logs[logs.length - 1], {});
    expect(v.fund).toBe(last.fund);
    expect(v.earned - v.spent - v.fined).toBe(last.fund);
    expect(v.crews.length).toBe(last.extra.length);
    expect(v.trained.length).toBe(last.trained.length);
    expect(v.decisions).toBeGreaterThan(0);
    expect(v.thanks + v.complaints).toBeGreaterThanOrEqual(0);
  });
});
