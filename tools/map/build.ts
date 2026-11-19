// Сборка карты района (ADR 0004; docs/02-architecture.md, §5): выгрузка OSM (tools/map/fetch.ts) → граф дорог и
// слои рисования в целых числах (src/map/format.ts) → src/map/generated/<id>.ts и паспорт assets/map/<id>.json.
// Повторная сборка из той же выгрузки даёт те же байты (tools/test/map.test.ts).
//
//   bun tools/map/build.ts nn-center [map-src/nn-center.osm.json]
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type MapData, type Polylines, writeMap } from '../../src/map/format';
import { area, type Area, OVERPASS, overpassQuery } from './areas';

interface LatLon { lat: number; lon: number }
interface Way { type: 'way'; id: number; nodes: number[]; geometry: LatLon[]; tags?: Record<string, string> }
interface Rel { type: 'relation'; id: number; members: { type: string; role: string; geometry?: LatLon[] }[]; tags?: Record<string, string> }
type El = Way | Rel | { type: 'node'; id: number; lat: number; lon: number; tags?: Record<string, string> };

/** Класс дороги для графа и рисования: 0 — магистрали … 3 — местные (src/map/format.ts). */
const CLASS: Record<string, number> = {
  motorway: 0, trunk: 0, primary: 0, motorway_link: 0, trunk_link: 0, primary_link: 0,
  secondary: 1, secondary_link: 1,
  tertiary: 2, tertiary_link: 2,
  unclassified: 3, residential: 3, living_street: 3,
};

/** Допуск упрощения линий, м: на телефоне меньше полуметра не видно. */
const SIMPLIFY_M = 1;
const R = 6371008.8;

export interface Built { map: MapData; bytes: Uint8Array; stats: Record<string, number>; osmBase: string; institutions: string[] }

export function build(a: Area, raw: string): Built {
  const json = JSON.parse(raw) as { osm3s?: { timestamp_osm_base?: string }; elements: El[] };
  const [s, w, n, e] = a.bbox;
  const lat0 = ((s + n) / 2) * Math.PI / 180;
  const kx = Math.cos(lat0) * R * Math.PI / 180;
  const ky = R * Math.PI / 180;
  const W = (e - w) * kx, H = (n - s) * ky;
  const xm = (p: LatLon) => (p.lon - w) * kx;
  const ym = (p: LatLon) => (n - p.lat) * ky;
  const inside = (p: LatLon) => p.lat >= s && p.lat <= n && p.lon >= w && p.lon <= e;
  const q = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v * 2)));
  const width = Math.round(W * 2), height = Math.round(H * 2);
  if (width > 65535 || height > 65535) throw new Error('район больше 32 км — не помещается в 16 бит');

  const els = [...json.elements].sort((x, y) => (x.type === y.type ? x.id - y.id : x.type < y.type ? -1 : 1));
  const ways = els.filter((x): x is Way => x.type === 'way');
  const rels = els.filter((x): x is Rel => x.type === 'relation');

  // ---- дороги: куски внутри рамки ----
  interface Run { ids: number[]; pts: LatLon[]; cls: number; oneway: boolean }
  const runs: Run[] = [];
  for (const wy of ways) {
    const t = wy.tags ?? {};
    const cls = CLASS[t.highway ?? ''];
    if (cls === undefined || !wy.geometry || wy.geometry.length !== wy.nodes.length) continue;
    if (t.access === 'no' || t.access === 'private' || t.area === 'yes') continue;
    let ids = wy.nodes, pts = wy.geometry;
    const ow = t.oneway;
    let oneway = ow === 'yes' || ow === 'true' || ow === '1' || ow === '-1' || ((t.junction === 'roundabout' || t.junction === 'circular') && ow !== 'no');
    if (ow === '-1') { ids = [...ids].reverse(); pts = [...pts].reverse(); }
    if (t.highway === 'motorway' && ow !== 'no') oneway = true;
    let cur: Run | null = null;
    for (let i = 0; i < ids.length; i++) {
      if (inside(pts[i])) {
        if (!cur) { cur = { ids: [], pts: [], cls, oneway }; runs.push(cur); }
        cur.ids.push(ids[i]);
        cur.pts.push(pts[i]);
      } else cur = null;
    }
  }
  const okRuns = runs.filter(r => r.ids.length >= 2);

  // ---- узлы графа: концы кусков и узлы, где куски встречаются ----
  const uses = new Map<number, number>();
  for (const r of okRuns) for (const id of r.ids) uses.set(id, (uses.get(id) ?? 0) + 1);
  const isNode = (r: Run, i: number) => i === 0 || i === r.ids.length - 1 || (uses.get(r.ids[i]) ?? 0) > 1;
  const where = new Map<number, LatLon>();
  interface Edge { a: number; b: number; pts: LatLon[]; cls: number; oneway: boolean; len: number }
  const edges: Edge[] = [];
  const seg = (p: LatLon, q2: LatLon) => Math.hypot(xm(p) - xm(q2), ym(p) - ym(q2));
  for (const r of okRuns) {
    let from = 0;
    for (let i = 1; i < r.ids.length; i++) {
      if (!isNode(r, i)) continue;
      const pts = r.pts.slice(from, i + 1);
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += seg(pts[k - 1], pts[k]);
      if (r.ids[from] !== r.ids[i] && len > 0) {
        edges.push({ a: r.ids[from], b: r.ids[i], pts, cls: r.cls, oneway: r.oneway, len });
        where.set(r.ids[from], r.pts[from]);
        where.set(r.ids[i], r.pts[i]);
      }
      from = i;
    }
  }

  // ---- оставляем самую большую сильно связную часть: из любого узла — в любой ----
  const ids = [...where.keys()].sort((x, y) => x - y);
  const idx = new Map(ids.map((id, i) => [id, i]));
  const N = ids.length;
  const fwd: number[][] = Array.from({ length: N }, () => []);
  const rev: number[][] = Array.from({ length: N }, () => []);
  for (const ed of edges) {
    const u = idx.get(ed.a)!, v = idx.get(ed.b)!;
    fwd[u].push(v); rev[v].push(u);
    if (!ed.oneway) { fwd[v].push(u); rev[u].push(v); }
  }
  const comp = scc(N, fwd, rev);
  const size = new Map<number, number>();
  for (const c of comp) size.set(c, (size.get(c) ?? 0) + 1);
  let best = -1, bestSize = -1;
  for (const [c, k] of [...size].sort((x, y) => x[0] - y[0])) if (k > bestSize) { best = c; bestSize = k; }
  const keepEdges = edges.filter(ed => comp[idx.get(ed.a)!] === best && comp[idx.get(ed.b)!] === best);
  const keepIds = ids.filter(id => comp[idx.get(id)!] === best);
  const nodeIdx = new Map(keepIds.map((id, i) => [id, i]));

  // ---- запись ----
  const nx = new Uint16Array(keepIds.length), ny = new Uint16Array(keepIds.length);
  keepIds.forEach((id, i) => { const p = where.get(id)!; nx[i] = q(xm(p), width); ny[i] = q(ym(p), height); });
  const shape = lines(keepEdges.map(ed => simplify(ed.pts.map(p => [xm(p), ym(p)] as [number, number]))), width, height);
  const map: MapData = {
    id: a.id,
    width,
    height,
    nodes: { x: nx, y: ny },
    edges: {
      a: Uint32Array.from(keepEdges, ed => nodeIdx.get(ed.a)!),
      b: Uint32Array.from(keepEdges, ed => nodeIdx.get(ed.b)!),
      len: Uint32Array.from(keepEdges, ed => Math.max(1, Math.round(ed.len * 100))),
      cls: Uint8Array.from(keepEdges, ed => ed.cls),
      oneway: Uint8Array.from(keepEdges, ed => (ed.oneway ? 1 : 0)),
      shape,
    },
    water: lines(rings(ways, rels, t => t.natural === 'water' || t.waterway === 'riverbank', xm, ym, W, H), width, height),
    green: lines(rings(ways, [], t => t.leisure === 'park' || t.landuse === 'forest', xm, ym, W, H), width, height),
    rail: lines(railRuns(ways, inside).map(pts => simplify(pts.map(p => [xm(p), ym(p)] as [number, number]))), width, height),
  };
  // учреждения района — чтобы имена вымышленных не совпали с настоящими (docs/09-content.md, §3)
  const institutions = [...new Set(els.filter(x => x.tags && (x.tags.amenity === 'hospital' || x.tags.emergency === 'ambulance_station') && x.tags.name).map(x => x.tags!.name!))].sort();
  const bytes = writeMap(map);
  return {
    map,
    bytes,
    osmBase: json.osm3s?.timestamp_osm_base ?? '',
    institutions,
    stats: {
      nodes: keepIds.length,
      edges: keepEdges.length,
      droppedEdges: edges.length - keepEdges.length,
      shapePoints: map.edges.shape.pts.length / 2,
      waterPoints: map.water.pts.length / 2,
      greenPoints: map.green.pts.length / 2,
      railPoints: map.rail.pts.length / 2,
      bytes: bytes.length,
    },
  };
}

/** Сильно связные части (Косараджу, без рекурсии): номер части у каждого узла. */
function scc(n: number, fwd: number[][], rev: number[][]): Int32Array {
  const seen = new Uint8Array(n);
  const order: number[] = [];
  for (let s0 = 0; s0 < n; s0++) {
    if (seen[s0]) continue;
    const stack: [number, number][] = [[s0, 0]];
    seen[s0] = 1;
    while (stack.length) {
      const top = stack[stack.length - 1];
      const [v, i] = top;
      if (i < fwd[v].length) {
        top[1]++;
        const u = fwd[v][i];
        if (!seen[u]) { seen[u] = 1; stack.push([u, 0]); }
      } else {
        order.push(v);
        stack.pop();
      }
    }
  }
  const comp = new Int32Array(n).fill(-1);
  let c = 0;
  for (let k = order.length - 1; k >= 0; k--) {
    const s0 = order[k];
    if (comp[s0] >= 0) continue;
    const stack = [s0];
    comp[s0] = c;
    while (stack.length) {
      const v = stack.pop()!;
      for (const u of rev[v]) if (comp[u] < 0) { comp[u] = c; stack.push(u); }
    }
    c++;
  }
  return comp;
}

/** Дугласа — Пекера, концы на месте. */
function simplify(pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let far = -1, dmax = SIMPLIFY_M;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((pts[k][0] - ax) * dy - (pts[k][1] - ay) * dx) / L;
      if (d > dmax) { dmax = d; far = k; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}

function lines(list: [number, number][][], width: number, height: number): Polylines {
  const starts = new Uint32Array(list.length + 1);
  let total = 0;
  list.forEach((l, i) => { starts[i] = total; total += l.length; });
  starts[list.length] = total;
  const pts = new Uint16Array(total * 2);
  let o = 0;
  const q = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v * 2)));
  for (const l of list) for (const [x, y] of l) { pts[o++] = q(x, width); pts[o++] = q(y, height); }
  return { starts, pts };
}

/** Железные дороги: куски внутри рамки. */
function railRuns(ways: Way[], inside: (p: LatLon) => boolean): LatLon[][] {
  const out: LatLon[][] = [];
  for (const wy of ways) {
    if (wy.tags?.railway !== 'rail' || !wy.geometry) continue;
    let cur: LatLon[] = [];
    for (const p of wy.geometry) {
      if (inside(p)) cur.push(p);
      else { if (cur.length >= 2) out.push(cur); cur = []; }
    }
    if (cur.length >= 2) out.push(cur);
  }
  return out;
}

/** Кольца многоугольников (замкнутые линии и внешние/внутренние члены отношений), обрезанные по рамке. */
function rings(ways: Way[], rels: Rel[], pick: (t: Record<string, string>) => boolean, xm: (p: LatLon) => number, ym: (p: LatLon) => number, W: number, H: number): [number, number][][] {
  const raw: LatLon[][] = [];
  for (const wy of ways) {
    if (!wy.tags || !pick(wy.tags) || !wy.geometry) continue;
    const g = wy.geometry;
    if (g.length >= 4 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon) raw.push(g);
  }
  for (const r of rels) {
    if (!r.tags || !pick(r.tags)) continue;
    const parts = r.members.filter(m => m.type === 'way' && m.geometry && m.geometry.length >= 2).map(m => m.geometry!);
    raw.push(...joinRings(parts));
  }
  const out: [number, number][][] = [];
  for (const ring of raw) {
    const clipped = clipRect(ring.map(p => [xm(p), ym(p)] as [number, number]), W, H);
    // кольцо упрощается как открытая линия: у замкнутой концы совпадают, и хорда вырождается в точку
    const ringPts = clipped.length >= 3 ? simplify(clipped) : [];
    if (ringPts.length >= 3) out.push(ringPts);
  }
  return out;
}

/** Склеить линии в замкнутые кольца по совпадающим концам; незамкнутое отбрасывается. */
function joinRings(parts: LatLon[][]): LatLon[][] {
  const key = (p: LatLon) => `${p.lat},${p.lon}`;
  const left = parts.map(p => [...p]);
  const out: LatLon[][] = [];
  while (left.length) {
    let ring = left.shift()!;
    let grown = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grown) {
      grown = false;
      const end = key(ring[ring.length - 1]);
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        if (key(p[0]) === end) { ring = ring.concat(p.slice(1)); left.splice(i, 1); grown = true; break; }
        if (key(p[p.length - 1]) === end) { ring = ring.concat([...p].reverse().slice(1)); left.splice(i, 1); grown = true; break; }
      }
    }
    if (ring.length >= 4 && key(ring[0]) === key(ring[ring.length - 1])) out.push(ring);
  }
  return out;
}

/** Обрезка многоугольника по прямоугольнику [0, W] × [0, H] (Сазерленд — Ходжмен). */
function clipRect(poly: [number, number][], W: number, H: number): [number, number][] {
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [p => p[0] >= 0, (a, b) => { const t = (0 - a[0]) / (b[0] - a[0]); return [0, a[1] + t * (b[1] - a[1])]; }],
    [p => p[0] <= W, (a, b) => { const t = (W - a[0]) / (b[0] - a[0]); return [W, a[1] + t * (b[1] - a[1])]; }],
    [p => p[1] >= 0, (a, b) => { const t = (0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), 0]; }],
    [p => p[1] <= H, (a, b) => { const t = (H - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), H]; }],
  ];
  let out = poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1] ? poly.slice(0, -1) : poly;
  for (const [ins, cut] of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const cur = src[i], prev = src[(i + src.length - 1) % src.length];
      if (ins(cur)) {
        if (!ins(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (ins(prev)) out.push(cut(prev, cur));
    }
    if (!out.length) break;
  }
  return out;
}

function sha(b: Uint8Array | string) {
  return createHash('sha256').update(b).digest('hex');
}

/** Модуль с файлом карты в base64: Metro кладёт его в сборку, игра читает без файловой системы. */
export function moduleText(id: string, bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  const name = `MAP_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return [
    '// Сгенерировано tools/map/build.ts — не править руками. Паспорт: assets/map/' + id + '.json.',
    '// Данные карты: © участники OpenStreetMap, Open Database License 1.0 (https://www.openstreetmap.org/copyright).',
    '// Это производная база данных OSM; она распространяется под ODbL 1.0 (ADR 0004).',
    `export const ${name} =`,
    `  '${b64}';`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  const id = process.argv[2] ?? 'nn-center';
  const a = area(id);
  const root = join(import.meta.dir, '../..');
  const input = process.argv[3] ?? join(root, 'map-src', `${id}.osm.json`);
  const raw = readFileSync(input, 'utf8');
  const out = build(a, raw);
  mkdirSync(join(root, 'src/map/generated'), { recursive: true });
  mkdirSync(join(root, 'assets/map'), { recursive: true });
  writeFileSync(join(root, 'src/map/generated', `${id}.ts`), moduleText(id, out.bytes));
  const passport = {
    id,
    name: a.name,
    bbox: a.bbox,
    licence: 'ODbL-1.0',
    attribution: '© участники OpenStreetMap — https://www.openstreetmap.org/copyright',
    source: {
      endpoint: OVERPASS,
      query: overpassQuery(a),
      osmBase: out.osmBase,
      sha256: sha(raw),
      bytes: Buffer.byteLength(raw),
    },
    output: { file: `src/map/generated/${id}.ts`, sha256: sha(out.bytes), ...out.stats, width: out.map.width, height: out.map.height },
    institutionsInArea: out.institutions,
    builder: 'tools/map/build.ts',
  };
  writeFileSync(join(root, 'assets/map', `${id}.json`), `${JSON.stringify(passport, null, 2)}\n`);
  console.log(JSON.stringify({ ...out.stats, osmBase: out.osmBase }, null, 1));
}
