// Дороги (docs/02-architecture.md, §8): поиск пути сверяется с перебором (Флойд — Уоршелл) на малых графах;
// обратный поиск даёт то же время, что прямой; на карте района из любого узла можно доехать в любой.
import { describe, expect, test } from 'bun:test';
import { type MapData, readMap, fromBase64 } from '../../src/map/format';
import { edgeTimes, roadOf } from '../../src/engine/road/graph';
import { FAR, pathFrom, pathTo, search } from '../../src/engine/road/route';
import { MAP_NN_CENTER } from '../../src/map/generated/nn-center';

/** Детерминированный генератор для тестов (xorshift32). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return (k: number) => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s % k;
  };
}

function randomMap(seed: number, n: number, m: number): MapData {
  const r = rng(seed);
  const a: number[] = [], b: number[] = [], len: number[] = [], cls: number[] = [], one: number[] = [];
  for (let i = 0; i < m; i++) {
    const u = r(n);
    let v = r(n);
    if (v === u) v = (u + 1) % n;
    a.push(u); b.push(v); len.push(100 + r(50000)); cls.push(r(4)); one.push(r(3) === 0 ? 1 : 0);
  }
  const lines = { starts: new Uint32Array(1), pts: new Uint16Array(0) };
  return {
    id: 't', width: 1, height: 1,
    nodes: { x: new Uint16Array(n), y: new Uint16Array(n) },
    edges: { a: Uint32Array.from(a), b: Uint32Array.from(b), len: Uint32Array.from(len), cls: Uint8Array.from(cls), oneway: Uint8Array.from(one), shape: lines },
    water: lines, green: lines, rail: lines,
  };
}

const KMH = [50, 40, 30, 20];

describe('поиск пути', () => {
  test('совпадает с перебором на 200 малых графах, вперёд и назад', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const n = 3 + (seed % 9), m = n + (seed % 17);
      const map = randomMap(seed, n, m);
      const road = roadOf(map);
      const t = edgeTimes(road, KMH, 80);
      const D: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)));
      for (let e = 0; e < m; e++) {
        const u = map.edges.a[e], v = map.edges.b[e];
        D[u][v] = Math.min(D[u][v], t[e]);
        if (!map.edges.oneway[e]) D[v][u] = Math.min(D[v][u], t[e]);
      }
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (D[i][k] + D[k][j] < D[i][j]) D[i][j] = D[i][k] + D[k][j];
      for (let s = 0; s < n; s++) {
        const fwd = search(road, t, s);
        const back = search(road, t, s, true);
        for (let v = 0; v < n; v++) {
          expect(fwd.dist[v] === FAR ? Infinity : fwd.dist[v]).toBe(D[s][v]);
          expect(back.dist[v] === FAR ? Infinity : back.dist[v]).toBe(D[v][s]);
        }
      }
    }
  });

  test('путь — цепочка настоящих рёбер, его время равно найденному', () => {
    const map = randomMap(7, 12, 30);
    const road = roadOf(map);
    const t = edgeTimes(road, KMH, 100);
    const tree = search(road, t, 0);
    for (let v = 1; v < 12; v++) {
      const p = pathTo(tree, v);
      if (!p.length) continue;
      let sum = 0;
      for (let i = 1; i < p.length; i++) sum += t[tree.via[p[i]]];
      expect(p[0]).toBe(0);
      expect(sum).toBe(tree.dist[v]);
    }
    const back = search(road, t, 5, true);
    for (let v = 0; v < 12; v++) {
      const p = pathFrom(back, v);
      if (p.length) expect(p[p.length - 1]).toBe(5);
    }
  });

  test('время ребра: целое, не меньше длины на скорости', () => {
    const road = roadOf(randomMap(3, 5, 8));
    const t = edgeTimes(road, KMH, 60);
    for (let e = 0; e < t.length; e++) {
      const exact = (road.len[e] * 3600) / (KMH[road.cls[e]] * 60);
      expect(Number.isInteger(t[e])).toBe(true);
      expect(t[e]).toBeGreaterThanOrEqual(exact);
      expect(t[e]).toBeLessThan(exact + 1);
    }
  });
});

describe('карта района nn-center', () => {
  const map = readMap(fromBase64(MAP_NN_CENTER));
  const road = roadOf(map);
  const t = edgeTimes(road, KMH, 80);

  test('из любого узла — в любой: одна сильно связная часть', () => {
    const fwd = search(road, t, 0);
    const back = search(road, t, 0, true);
    expect([...fwd.dist].filter(d => d === FAR).length).toBe(0);
    expect([...back.dist].filter(d => d === FAR).length).toBe(0);
  });

  test('обратный поиск по району — быстро: до 40 мс в Bun', () => {
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) search(road, t, (i * 97) % road.n, true);
    expect((performance.now() - t0) / 20).toBeLessThan(40);
  });
});
