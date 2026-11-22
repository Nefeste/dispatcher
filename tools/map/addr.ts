// Адреса района (игра владельца 22.11.2026): выгрузка домов OSM (tools/map/fetch.ts --addr) → у каждого узла дорог
// готовой карты — до трёх ближайших домов → src/map/generated/<id>.addr.ts и паспорт assets/map/<id>.addr.json.
// Карта дорог не меняется: узлы берутся из её модуля, той же проекцией, что в tools/map/build.ts. Повторная сборка из
// той же выгрузки даёт те же байты (tools/test/address.test.ts).
//
//   bun tools/map/addr.ts nn-center [map-src/nn-center.addr.osm.json]
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AddrData } from '../../src/map/address';
import type { MapData } from '../../src/map/format';
import { loadMap } from '../../src/map/load';
import { addrQuery, area, type Area, OVERPASS } from './areas';

/** Дома в этом радиусе от узла — кандидаты адреса вызова, м. */
export const NEAR_M = 80;
/** Ближайший дом дальше — «около дома». */
export const FAR_M = 150;
/** Сколько домов у узла. */
export const PER_NODE = 3;
const R = 6371008.8;

interface El { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

export interface AddrBuilt { data: AddrData; text: string; stats: Record<string, number>; osmBase: string }

/** Тип улицы — вперёд и сокращённо, как пишут адрес: «Большая Покровская улица» → «ул. Большая Покровская». */
const TYPES: Record<string, string> = {
  улица: 'ул.', проспект: 'просп.', площадь: 'пл.', переулок: 'пер.', бульвар: 'б-р', набережная: 'наб.', шоссе: 'ш.',
  проезд: 'пр-д', тупик: 'туп.', аллея: 'ал.',
};

export function streetLabel(osm: string): string {
  const words = osm.trim().split(/\s+/);
  const i = words.findIndex(w => TYPES[w.toLowerCase()] !== undefined);
  if (i < 0 || words.length === 1) return words.join(' ');
  return `${TYPES[words[i].toLowerCase()]} ${[...words.slice(0, i), ...words.slice(i + 1)].join(' ')}`;
}

/** Номер дома как пишут: без лишних пробелов, «12 к1» → «12к1»; знаки разметки файла не допускаются. */
export function houseLabel(raw: string): string | null {
  const h = raw.trim().replace(/\s+/g, ' ').replace(/\s+(к|корп\.?)\s*(\d)/i, 'к$2');
  return /[;|:~]/.test(h) || !h ? null : h;
}

/** Улица из OSM, очищенная от ошибок разметки: «addr:street=[…]» — то, что в скобках; точка в конце полного слова —
 *  лишняя; латиница — не русский адрес, такой дом пропускаем. */
export function streetOf(raw: string): string | null {
  let t = raw.trim().replace(/^addr:street=\[(.*)\]$/, '$1').trim();
  if (/[A-Za-z]/.test(t) || !t) return null;
  const last = t.split(/\s+/).at(-1)!;
  if (last.endsWith('.') && last.length > 3) t = t.slice(0, -1);
  return streetLabel(t);
}

export function buildAddr(a: Area, raw: string, map: MapData): AddrBuilt {
  const json = JSON.parse(raw) as { osm3s?: { timestamp_osm_base?: string }; elements: El[] };
  const [s, w, n] = a.bbox;
  const lat0 = ((s + n) / 2) * Math.PI / 180;
  const kx = Math.cos(lat0) * R * Math.PI / 180;
  const ky = R * Math.PI / 180;
  // дома: улица, номер, точка в метрах от северо-западного угла; один адрес — один раз (дом и магазин в нём)
  const seen = new Set<string>();
  const homes: { street: string; house: string; x: number; y: number }[] = [];
  const els = [...json.elements].sort((p, q) => (p.type === q.type ? p.id - q.id : p.type < q.type ? -1 : 1));
  let skipped = 0;
  for (const el of els) {
    const c = el.center ?? (el.lat !== undefined && el.lon !== undefined ? { lat: el.lat, lon: el.lon } : null);
    const t = el.tags ?? {};
    const house = houseLabel(t['addr:housenumber'] ?? '');
    const street = streetOf(t['addr:street'] ?? '');
    if (!c || !house || !street) { skipped++; continue; }
    const key = `${street}\u0000${house}`;
    if (seen.has(key)) continue;
    seen.add(key);
    homes.push({ street, house, x: (c.lon - w) * kx, y: (n - c.lat) * ky });
  }
  const streets = [...new Set(homes.map(h => h.street))].sort((p, q) => p.localeCompare(q, 'ru'));
  const sid = new Map(streets.map((x, i) => [x, i]));
  // сетка 100 м — ближайшие дома без перебора всех
  const CELL = 100;
  const grid = new Map<string, number[]>();
  homes.forEach((h, i) => {
    const k = `${Math.floor(h.x / CELL)},${Math.floor(h.y / CELL)}`;
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const cells: string[] = [];
  let far = 0, empty = 0;
  const N = map.nodes.x.length;
  for (let v = 0; v < N; v++) {
    const x = map.nodes.x[v] / 2, y = map.nodes.y[v] / 2;
    let found: { i: number; d: number }[] = [];
    for (let r = 1; r <= 40 && (found.length === 0 || (r - 1) * CELL < NEAR_M); r++) {
      found = [];
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      for (let gx = cx - r; gx <= cx + r; gx++) for (let gy = cy - r; gy <= cy + r; gy++) {
        for (const i of grid.get(`${gx},${gy}`) ?? []) found.push({ i, d: Math.hypot(homes[i].x - x, homes[i].y - y) });
      }
    }
    found.sort((p, q) => p.d - q.d || p.i - q.i);
    if (!found.length) { cells.push(''); empty++; continue; }
    const near = found.filter(f => f.d <= NEAR_M).slice(0, PER_NODE);
    const pick = near.length ? near : [found[0]];
    const isFar = found[0].d > FAR_M;
    if (isFar) far++;
    cells.push(`${isFar ? '~' : ''}${pick.map(f => `${sid.get(homes[f.i].street)}:${homes[f.i].house}`).join('|')}`);
  }
  const data: AddrData = { streets, at: cells.join(';') };
  return {
    data,
    text: moduleText(a.id, data),
    stats: { elements: json.elements.length, homes: homes.length, skipped, streets: streets.length, nodes: N, far, empty },
    osmBase: json.osm3s?.timestamp_osm_base ?? '',
  };
}

export function moduleText(id: string, data: AddrData): string {
  const name = `ADDR_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  return [
    `// Сгенерировано tools/map/addr.ts — не править руками. Паспорт: assets/map/${id}.addr.json.`,
    '// Адреса домов: © участники OpenStreetMap, Open Database License 1.0 (https://www.openstreetmap.org/copyright).',
    '// Это производная база данных OSM; она распространяется под ODbL 1.0 (ADR 0004).',
    "import type { AddrData } from '../address';",
    '',
    `export const ${name}: AddrData = {`,
    `  streets: ${JSON.stringify(data.streets)},`,
    `  at: ${JSON.stringify(data.at)},`,
    '};',
    '',
  ].join('\n');
}

const sha = (b: string) => createHash('sha256').update(b).digest('hex');

if (import.meta.main) {
  const id = process.argv[2] ?? 'nn-center';
  const a = area(id);
  const root = join(import.meta.dir, '../..');
  const input = process.argv[3] ?? join(root, 'map-src', `${id}.addr.osm.json`);
  const raw = readFileSync(input, 'utf8');
  const out = buildAddr(a, raw, loadMap(id));
  writeFileSync(join(root, 'src/map/generated', `${id}.addr.ts`), out.text);
  const passport = {
    id,
    name: a.name,
    bbox: a.bbox,
    licence: 'ODbL-1.0',
    attribution: '© участники OpenStreetMap — https://www.openstreetmap.org/copyright',
    source: { endpoint: OVERPASS, query: addrQuery(a), osmBase: out.osmBase, sha256: sha(raw), bytes: Buffer.byteLength(raw) },
    rule: { nearM: NEAR_M, farM: FAR_M, perNode: PER_NODE },
    output: { file: `src/map/generated/${id}.addr.ts`, sha256: sha(out.text), ...out.stats },
    builder: 'tools/map/addr.ts',
  };
  writeFileSync(join(root, 'assets/map', `${id}.addr.json`), `${JSON.stringify(passport, null, 2)}\n`);
  console.log(JSON.stringify({ ...out.stats, osmBase: out.osmBase }, null, 1));
}
