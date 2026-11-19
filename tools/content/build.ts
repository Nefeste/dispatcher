// Сборка содержания (docs/04-data-model.md, §1; docs/09-content.md, «Проверки»): content/*.yaml → проверки →
// src/content/generated/db.ts (не в git). Идентификатор записи — из пути (crews/general.yaml → crew.general).
// Сообщения об ошибках — по-английски: их видит разработчик, а не игрок.
//
//   bun tools/content/build.ts           # собрать и записать
//   bun tools/content/build.ts --check   # только проверить
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import type { City, CrewKind, Db, Hospital, Place, Roads, ShiftSetup } from '../../src/content/types';
import { roadOf } from '../../src/engine/road/graph';
import { FAR, search } from '../../src/engine/road/route';
import type { MapData } from '../../src/map/format';
import { loadMap } from '../../src/map/load';

const ROOT = join(import.meta.dir, '../..');
const CONTENT = join(ROOT, 'content');
const OUT = join(ROOT, 'src/content/generated/db.ts');
/** дальше — точку записи не привязать к дорогам: значит, она не там */
const SNAP_M = 300;

type Raw = Record<string, unknown>;
const read = (path: string): Raw => parse(readFileSync(path, 'utf8')) as Raw;
const records = (root: string, dir: string, prefix: string) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir)).filter(f => f.endsWith('.yaml')).sort().map(f => [`${prefix}.${basename(f, '.yaml')}`, read(join(root, dir, f))] as const)
    : [];

/** Имя учреждения без регистра, пробелов и знака номера — чтобы «Больница № 2» совпала с «Больница №2». */
const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[\s№«»"]/g, '');

function nearest(m: MapData, x: number, y: number): { node: number; m: number } {
  let best = -1, bd = Infinity;
  for (let i = 0; i < m.nodes.x.length; i++) {
    const d = (m.nodes.x[i] - x) ** 2 + (m.nodes.y[i] - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return { node: best, m: Math.sqrt(bd) / 2 };
}

export function buildDb(dir = CONTENT): { db: Db; errors: string[] } {
  const errors: string[] = [];
  const err = (s: string) => errors.push(s);

  const r = read(join(dir, 'roads.yaml'));
  const roads: Roads = { estimate: Boolean(r.estimate), kmh: (r.kmh as number[]) ?? [], hours: (r.hours as Roads['hours']) ?? [] };
  if (roads.kmh.length !== 4 || roads.kmh.some(v => !Number.isInteger(v) || v <= 0)) err('roads: kmh must be 4 positive integers');
  if (!roads.hours.length || roads.hours[0].from !== 0) err('roads: hours must start at 0');
  roads.hours.forEach((h, i) => {
    if (!Number.isInteger(h.pct) || h.pct <= 0) err(`roads: hour ${h.from} pct must be a positive integer`);
    if (i > 0 && h.from <= roads.hours[i - 1].from) err('roads: hours must go up');
    if (h.from < 0 || h.from > 23) err(`roads: hour ${h.from} out of 0..23`);
  });

  const crews: Record<string, CrewKind> = {};
  for (const [id, c] of records(dir, 'crews', 'crew')) {
    const k: CrewKind = { id, name: String(c.name ?? ''), class: c.class as CrewKind['class'], sources: (c.sources as string[]) ?? [], review: c.review as CrewKind['review'] };
    if (!k.name) err(`${id}: no name`);
    if (!['A', 'B', 'C'].includes(k.class)) err(`${id}: class must be A, B or C`);
    if (!k.sources.length) err(`${id}: no sources`);
    if (k.review !== 'draft' && k.review !== 'checked') err(`${id}: review must be draft or checked`);
    crews[id] = k;
  }

  const cities: Record<string, City> = {};
  for (const [id, c] of records(dir, 'cities', 'city')) {
    const mapId = String(c.map ?? '');
    let map: MapData;
    try { map = loadMap(mapId); } catch { err(`${id}: no map ${mapId}`); continue; }
    const passport = JSON.parse(readFileSync(join(ROOT, 'assets/map', `${mapId}.json`), 'utf8'));
    const real = new Set<string>((passport.institutionsInArea as string[]).map(norm));
    const place = (p: Raw): Place => {
      const at = p.at as [number, number];
      const s = nearest(map, at[0], at[1]);
      if (s.m > SNAP_M) err(`${id}: ${String(p.id)} is ${Math.round(s.m)} m from the nearest road`);
      if (real.has(norm(String(p.name)))) err(`${id}: ${String(p.id)} carries the name of a real institution: ${String(p.name)}`);
      return { id: String(p.id), name: String(p.name), at, node: s.node };
    };
    const bases = ((c.bases as Raw[]) ?? []).map(place);
    const hospitals: Hospital[] = ((c.hospitals as Raw[]) ?? []).map(h => ({ ...place(h), profiles: (h.profiles as string[]) ?? [] }));
    if (!bases.length) err(`${id}: no bases`);
    if (!hospitals.length) err(`${id}: no hospitals`);
    const ids = [...bases, ...hospitals].map(p => p.id);
    if (new Set(ids).size !== ids.length) err(`${id}: duplicate place ids`);
    // от каждой подстанции — до каждой больницы и обратно
    const road = roadOf(map);
    const unit = new Uint32Array(road.len.length).fill(1);
    for (const b of bases) {
      const there = search(road, unit, b.node);
      const back = search(road, unit, b.node, true);
      for (const h of hospitals) {
        if (there.dist[h.node] === FAR) err(`${id}: ${h.id} not reachable from ${b.id}`);
        if (back.dist[h.node] === FAR) err(`${id}: ${b.id} not reachable from ${h.id}`);
      }
    }
    cities[id] = { id, map: mapId, bases, hospitals };
  }

  const shifts: Record<string, ShiftSetup> = {};
  for (const [id, s] of records(dir, 'shifts', 'shift')) {
    const setup: ShiftSetup = { id, city: String(s.city ?? ''), start: Number(s.start), length: Number(s.length), crews: (s.crews as ShiftSetup['crews']) ?? [] };
    const city = cities[setup.city];
    if (!city) err(`${id}: no city ${setup.city}`);
    if (!Number.isInteger(setup.start) || setup.start < 0 || setup.start >= 86400) err(`${id}: start must be seconds in a day`);
    if (!Number.isInteger(setup.length) || setup.length <= 0) err(`${id}: length must be positive seconds`);
    const seen = new Set<string>();
    for (const c of setup.crews) {
      if (seen.has(c.id)) err(`${id}: duplicate crew ${c.id}`);
      seen.add(c.id);
      if (!crews[c.kind]) err(`${id}: ${c.id} has unknown kind ${c.kind}`);
      if (city && !city.bases.some(b => b.id === c.base)) err(`${id}: ${c.id} has unknown base ${c.base}`);
    }
    shifts[id] = setup;
  }
  return { db: { roads, crews, cities, shifts }, errors };
}

export function moduleText(db: Db): string {
  return [
    '// Сделано tools/content/build.ts из content/ — руками не править.',
    "import type { Db } from '../types';",
    '',
    `export const DB: Db = ${JSON.stringify(db, null, 1)};`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  const { db, errors } = buildDb();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  if (!process.argv.includes('--check')) {
    mkdirSync(join(ROOT, 'src/content/generated'), { recursive: true });
    writeFileSync(OUT, moduleText(db));
  }
  const n = Object.keys(db.crews).length + Object.keys(db.cities).length + Object.keys(db.shifts).length + 1;
  console.log(`содержание: ${n} записей, ошибок нет`);
}
