// Граф дорог для движка (docs/02-architecture.md, §5): соседи узлов в сжатом виде (CSR) — вперёд и назад, время
// проезда ребра в миллисекундах — целое. Чистый TypeScript: без часов и случайности (ADR студии 0004).
import type { MapData } from '../../map/format';

export interface Road {
  /** узлов */
  n: number;
  /** исходящие: рёбра узла v — fEdge[fStart[v] .. fStart[v+1]), куда — fTo */
  fStart: Uint32Array;
  fTo: Uint32Array;
  fEdge: Uint32Array;
  /** входящие: те же рёбра со стороны узла, куда они ведут */
  rStart: Uint32Array;
  rTo: Uint32Array;
  rEdge: Uint32Array;
  len: Uint32Array;
  cls: Uint8Array;
}

/** Граф из карты: двустороннее ребро даёт ход в обе стороны, одностороннее — только от a к b. */
export function roadOf(m: MapData): Road {
  const n = m.nodes.x.length;
  const E = m.edges.a.length;
  const fCount = new Uint32Array(n + 1);
  const rCount = new Uint32Array(n + 1);
  const arc = (u: number, v: number) => { fCount[u + 1]++; rCount[v + 1]++; };
  for (let e = 0; e < E; e++) {
    arc(m.edges.a[e], m.edges.b[e]);
    if (!m.edges.oneway[e]) arc(m.edges.b[e], m.edges.a[e]);
  }
  for (let v = 0; v < n; v++) { fCount[v + 1] += fCount[v]; rCount[v + 1] += rCount[v]; }
  const arcs = fCount[n];
  const fTo = new Uint32Array(arcs), fEdge = new Uint32Array(arcs), rTo = new Uint32Array(arcs), rEdge = new Uint32Array(arcs);
  const fPos = fCount.slice(0, n), rPos = rCount.slice(0, n);
  const put = (u: number, v: number, e: number) => {
    fTo[fPos[u]] = v; fEdge[fPos[u]++] = e;
    rTo[rPos[v]] = u; rEdge[rPos[v]++] = e;
  };
  for (let e = 0; e < E; e++) {
    put(m.edges.a[e], m.edges.b[e], e);
    if (!m.edges.oneway[e]) put(m.edges.b[e], m.edges.a[e], e);
  }
  return { n, fStart: fCount, fTo, fEdge, rStart: rCount, rTo, rEdge, len: m.edges.len, cls: m.edges.cls };
}

/**
 * Время проезда каждого ребра, мс: длина ÷ скорость класса дороги × час суток. Скорость — км/ч, множитель часа —
 * в процентах (числа — docs/08-game-design.md, §9). Только целые: время = ⌈длина_см × 36 × 100 ÷ (км/ч × %)⌉.
 */
export function edgeTimes(road: Road, kmh: readonly number[], hourPct: number): Uint32Array {
  const out = new Uint32Array(road.len.length);
  for (let e = 0; e < out.length; e++) {
    const d = kmh[road.cls[e]] * hourPct;
    out[e] = Math.floor((road.len[e] * 3600 + d - 1) / d);
  }
  return out;
}
