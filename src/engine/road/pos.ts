// Путь бригады по улицам и её место на нём в момент t (docs/02-architecture.md, §3 и §5; docs/08-game-design.md, §5).
// Путь — узлы и рёбра поиска с целыми временами; место между узлами экран считает каждый кадр по форме ребра — в
// состояние смены оно не пишется. Чистый TypeScript, без часов и случайности.
import type { MapData } from '../../map/format';
import type { Road } from './graph';
import { FAR, search } from './route';

export interface Route {
  /** узлы пути от выезда до цели */
  nodes: Uint32Array;
  /** ребро между узлами i и i + 1 */
  edges: Uint32Array;
  /** время от выезда до узла i, мс; at[0] = 0 */
  at: Uint32Array;
  /** когда выехала, мс от начала смены */
  start: number;
}

/** Путь от `from` до `to` по прямому поиску, выезд — в `start` мс; null — не доехать. */
export function routeOf(road: Road, times: Uint32Array, from: number, to: number, start: number): Route | null {
  const t = search(road, times, from);
  if (t.dist[to] === FAR) return null;
  const rev: number[] = [to];
  while (t.from[rev[rev.length - 1]] >= 0) rev.push(t.from[rev[rev.length - 1]]);
  const nodes = Uint32Array.from(rev.reverse());
  const edges = new Uint32Array(Math.max(0, nodes.length - 1));
  const at = new Uint32Array(nodes.length);
  for (let i = 1; i < nodes.length; i++) {
    edges[i - 1] = t.via[nodes[i]];
    at[i] = t.dist[nodes[i]];
  }
  return { nodes, edges, at, start };
}

/** Когда бригада будет у цели, мс от начала смены. */
export function arrival(r: Route): number {
  return r.start + r.at[r.at.length - 1];
}

/** Номер последнего узла пути, который бригада проехала к моменту `t` (мс от начала смены). */
export function passed(r: Route, t: number): number {
  const dt = t - r.start;
  if (dt <= 0) return 0;
  let lo = 0, hi = r.at.length - 1;
  if (dt >= r.at[hi]) return hi;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (r.at[mid] <= dt) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** Место бригады в момент `t` — точка карты (единицы 0,5 м), по форме ребра; для рисования, не для состояния. */
export function pointAt(m: MapData, r: Route, t: number): [number, number] {
  const i = passed(r, t);
  const n = r.nodes[i];
  if (i >= r.edges.length) return [m.nodes.x[n], m.nodes.y[n]];
  const e = r.edges[i];
  const span = r.at[i + 1] - r.at[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (t - r.start - r.at[i]) / span)) : 1;
  const { starts, pts } = m.edges.shape;
  const s0 = starts[e], s1 = starts[e + 1];
  const forward = m.edges.a[e] === n;
  // длина формы по отрезкам, затем точка на доле f от начала
  let total = 0;
  for (let k = s0; k < s1 - 1; k++) total += Math.hypot(pts[(k + 1) * 2] - pts[k * 2], pts[(k + 1) * 2 + 1] - pts[k * 2 + 1]);
  let want = (forward ? f : 1 - f) * total;
  for (let k = s0; k < s1 - 1; k++) {
    const x0 = pts[k * 2], y0 = pts[k * 2 + 1], x1 = pts[(k + 1) * 2], y1 = pts[(k + 1) * 2 + 1];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (want <= d || k === s1 - 2) {
      const g = d > 0 ? Math.min(1, want / d) : 0;
      return [x0 + (x1 - x0) * g, y0 + (y1 - y0) * g];
    }
    want -= d;
  }
  return [m.nodes.x[n], m.nodes.y[n]];
}
