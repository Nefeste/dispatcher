// Поиск пути (docs/02-architecture.md, §5): Дейкстра на двоичной куче из массивов, целые миллисекунды.
// Обратный поиск от адреса вызова даёт время доезда сразу для всех бригад — один поиск на выбор бригады.
import type { Road } from './graph';

/** «Не доехать» — больше любого настоящего времени. */
export const FAR = 0xffffffff;

export interface Tree {
  /** время от источника (вперёд) или до цели (назад), мс; FAR — не доехать */
  dist: Uint32Array;
  /** ребро, по которому пришли в узел; -1 — источник или не достигнут */
  via: Int32Array;
  /** узел, из которого пришли (вперёд) или куда ведёт ребро (назад) */
  from: Int32Array;
}

/**
 * Дейкстра от узла `src`. `back` — по входящим рёбрам: dist[v] — время от v до src.
 * Куча — пары (время, узел) в двух массивах, устаревшие записи пропускаются.
 */
export function search(road: Road, times: Uint32Array, src: number, back = false): Tree {
  const n = road.n;
  const dist = new Uint32Array(n).fill(FAR);
  const via = new Int32Array(n).fill(-1);
  const from = new Int32Array(n).fill(-1);
  const start = back ? road.rStart : road.fStart;
  const to = back ? road.rTo : road.fTo;
  const edge = back ? road.rEdge : road.fEdge;
  let cap = 1024;
  let hk = new Uint32Array(cap), hv = new Uint32Array(cap);
  let size = 0;
  const push = (k: number, v: number) => {
    if (size === cap) {
      cap *= 2;
      const nk = new Uint32Array(cap), nv = new Uint32Array(cap);
      nk.set(hk); nv.set(hv); hk = nk; hv = nv;
    }
    let i = size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hk[p] < k || (hk[p] === k && hv[p] <= v)) break;
      hk[i] = hk[p]; hv[i] = hv[p]; i = p;
    }
    hk[i] = k; hv[i] = v;
  };
  const pop = () => {
    const k = hk[0], v = hv[0];
    const lk = hk[--size], lv = hv[size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= size) break;
      if (c + 1 < size && (hk[c + 1] < hk[c] || (hk[c + 1] === hk[c] && hv[c + 1] < hv[c]))) c++;
      if (lk < hk[c] || (lk === hk[c] && lv <= hv[c])) break;
      hk[i] = hk[c]; hv[i] = hv[c]; i = c;
    }
    hk[i] = lk; hv[i] = lv;
    return [k, v] as const;
  };
  dist[src] = 0;
  push(0, src);
  while (size > 0) {
    const [d, v] = pop();
    if (d !== dist[v]) continue;
    for (let i = start[v]; i < start[v + 1]; i++) {
      const u = to[i], e = edge[i];
      const nd = d + times[e];
      if (nd < dist[u]) {
        dist[u] = nd; via[u] = e; from[u] = v;
        push(nd, u);
      }
    }
  }
  return { dist, via, from };
}

/** Путь узлами от источника прямого поиска до `v`; пусто — не доехать. */
export function pathTo(t: Tree, v: number): number[] {
  if (t.dist[v] === FAR) return [];
  const out = [v];
  while (t.from[out[out.length - 1]] >= 0) out.push(t.from[out[out.length - 1]]);
  return out.reverse();
}

/** Путь узлами от `v` до цели обратного поиска; пусто — не доехать. */
export function pathFrom(t: Tree, v: number): number[] {
  if (t.dist[v] === FAR) return [];
  const out = [v];
  while (t.from[out[out.length - 1]] >= 0) out.push(t.from[out[out.length - 1]]);
  return out;
}
