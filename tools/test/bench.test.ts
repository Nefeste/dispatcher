// «Замер» (спецификация прототипа, §8; src/state/bench.ts): сводки кадров и времён считают по-честному, узлы поиска
// одни и те же на любом телефоне, а смена сцены «Пульт» к своей минуте держит бригады на улицах и идёт дальше без
// отказов — замер на телефоне меряет ту же картину, что здесь.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { fingerprint } from '../../src/engine/core/hash';
import { type ShiftCtx, shiftCtx } from '../../src/engine/shift';
import { loadMap } from '../../src/map/load';
import { BENCH_SHIFT, BUDGET, benchShift, benchStep, frameSummary, framesOk, msSummary, onRoad, quantile, searchNodes, timeSearches } from '../../src/state/bench';

const ctx: ShiftCtx = shiftCtx(DB, MED, 'shift.proto', loadMap(DB.cities['city.proto'].map));

describe('сводки', () => {
  test('медиана и доля долгих кадров', () => {
    const f = frameSummary([16, 17, 16, 17, 16, 40]);
    expect(f.n).toBe(6);
    expect(Math.round(f.fps)).toBe(63);
    expect(f.long).toBeCloseTo(1 / 6);
    expect(f.worst).toBe(40);
    expect(framesOk(f)).toBe(false);
    expect(framesOk(frameSummary(Array.from({ length: 200 }, (_, i) => (i === 0 ? 30 : 16.7))))).toBe(true);
    expect(framesOk(frameSummary([]))).toBe(false);
  });
  test('квантили по ближайшему рангу', () => {
    expect(quantile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(msSummary([2, 9, 4]).max).toBe(9);
    expect(msSummary([]).n).toBe(0);
  });
  test('бюджет — числа §8', () => {
    expect(BUDGET.fps).toBe(60);
    expect(BUDGET.longMs).toBe(25);
    expect(BUDGET.searchMs).toBe(8);
    expect(BUDGET.startMs).toBe(3000);
  });
});

describe('поиск пути', () => {
  test('узлы — от зерна, в пределах района', () => {
    const a = searchNodes(ctx.map.nodes.x.length, 50);
    expect(a).toEqual(searchNodes(ctx.map.nodes.x.length, 50));
    expect(a.every(v => v >= 0 && v < ctx.map.nodes.x.length)).toBe(true);
    expect(new Set(a).size).toBeGreaterThan(40);
  });
  test('время поиска мерится на каждом узле', () => {
    const ms = timeSearches(ctx, searchNodes(ctx.map.nodes.x.length, 5), () => performance.now());
    expect(ms.length).toBe(5);
    expect(ms.every(x => x >= 0)).toBe(true);
  });
});

describe('смена сцены «Пульт»', () => {
  test('с 70-й минуты зерна 1 в замере в среднем больше двух машин на улицах; без отказов; та же смена — та же картина', () => {
    const run = () => {
      const s = benchShift(ctx, BENCH_SHIFT.seed, BENCH_SHIFT.minute);
      expect(s.t).toBeGreaterThanOrEqual(BENCH_SHIFT.minute * 60_000);
      expect(s.open).toBeNull();
      let sum = 0;
      // 10 секунд замера при ×4: 96 игровых мс на мс, шаг — кадр 60 к/с
      for (let i = 0; i < 600; i++) {
        benchStep(ctx, s, 16 * 96);
        sum += onRoad(s);
      }
      expect(s.over).toBe(false);
      expect(s.open).toBeNull();
      return { s, mean: sum / 600 };
    };
    const a = run();
    expect(a.mean).toBeGreaterThan(2);
    expect(fingerprint({ ...run().s, rev: 0 })).toBe(fingerprint({ ...a.s, rev: 0 }));
  });
});

describe('отметки запуска', () => {
  test('пульт — только первый кадр после вставки «начало смены»; без начала процесса — нет запуска', async () => {
    const { mark, marks, startTimes } = await import('../../src/state/marks');
    mark('startTap');
    mark('loaded');
    mark('pult'); // пульт до вставки (продолженная смена) — не считается
    expect(marks().pult).toBeUndefined();
    mark('insertDone');
    mark('pult');
    const first = marks().pult!;
    mark('pult'); // пульт после разговора — тоже не считается
    expect(marks().pult).toBe(first);
    const t = startTimes(marks(), null);
    expect(t.cold).toBeNull();
    expect(t.load).not.toBeNull();
    expect(t.pult).toBeGreaterThanOrEqual(0);
  });
});
