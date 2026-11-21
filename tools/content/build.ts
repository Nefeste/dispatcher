// Сборка содержания (docs/04-data-model.md, §1; docs/09-content.md, «Проверки»): content/*.yaml → проверки →
// src/content/generated/db.ts (не в git). Идентификатор записи — из пути (crews/general.yaml → crew.general).
// Сообщения об ошибках — по-английски: их видит разработчик, а не игрок.
//
//   bun tools/content/build.ts           # собрать и записать
//   bun tools/content/build.ts --check   # только проверить
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from 'yaml';
import type { ContentDb } from '../../src/content/med';
import { type Base, type City, type CrewKind, type Db, type Flow, type Hospital, type Place, PROFILES, type Profile, type Roads, type ShiftSetup } from '../../src/content/types';
import { roadOf } from '../../src/engine/road/graph';
import { FAR, search } from '../../src/engine/road/route';
import type { MapData } from '../../src/map/format';
import { loadMap } from '../../src/map/load';
import { buildPhone } from './phone';

const ROOT = join(import.meta.dir, '../..');
const CONTENT = join(ROOT, 'content');
const OUT = join(ROOT, 'src/content/generated/db.ts');
const MED_OUT = join(ROOT, 'src/content/generated/med.ts');
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

export function buildDb(dir = CONTENT): { db: Db; med: ContentDb; errors: string[] } {
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

  const f = read(join(dir, 'flow.yaml'));
  const flow: Flow = { estimate: Boolean(f.estimate), hours: (f.hours as Flow['hours']) ?? [] };
  if (!flow.estimate) err('flow: the numbers are an estimate — set estimate: true');
  if (!flow.hours.length || flow.hours[0].from !== 0) err('flow: hours must start at 0');
  flow.hours.forEach((h, i) => {
    if (!(h.perHour > 0)) err(`flow: hour ${h.from} perHour must be positive`);
    if (i > 0 && h.from <= flow.hours[i - 1].from) err('flow: hours must go up');
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
    const bases: Base[] = ((c.bases as Raw[]) ?? []).map(b => {
      if (typeof b.short !== 'string' || !b.short) err(`${id}: ${String(b.id)} has no short name`);
      return { ...place(b), short: String(b.short ?? b.name) };
    });
    const hospitals: Hospital[] = ((c.hospitals as Raw[]) ?? []).map(h => {
      const profiles = (h.profiles as Profile[]) ?? [];
      for (const p of profiles) if (!PROFILES.includes(p)) err(`${id}: ${String(h.id)} has unknown profile ${p}`);
      return { ...place(h), profiles };
    });
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
    const setup: ShiftSetup = {
      id, city: String(s.city ?? ''), start: Number(s.start), length: Number(s.length), season: s.season as ShiftSetup['season'],
      crews: (s.crews as ShiftSetup['crews']) ?? [], script: (s.script as ShiftSetup['script']) ?? [],
      flowPct: s.flow === undefined ? 100 : Number(s.flow), hospitals: (s.hospitals as string[] | undefined) ?? null,
      week: (s.week as ShiftSetup['week'] | undefined) ?? null, clinic: s.clinic === true,
    };
    if (!Number.isInteger(setup.flowPct) || setup.flowPct < 10 || setup.flowPct > 300) err(`${id}: flow must be a whole percent, 10…300`);
    if (setup.week) {
      const w = setup.week;
      if (!(Number.isInteger(w.n) && w.n >= 1 && w.n <= 7)) err(`${id}: week.n must be 1…7`);
      if (!w.day || !w.what) err(`${id}: week needs day and what`);
    }
    if (!['winter', 'spring', 'summer', 'autumn'].includes(setup.season)) err(`${id}: season must be winter, spring, summer or autumn`);
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
    if (setup.hospitals) {
      if (!setup.hospitals.length) err(`${id}: hospitals, if given, must not be empty`);
      for (const h of setup.hospitals) if (city && !city.hospitals.some(x => x.id === h)) err(`${id}: unknown hospital ${h}`);
    }
    shifts[id] = setup;
  }

  // «Первая неделя»: семь смен, номера 1…7 — каждый один раз
  const week = Object.values(shifts).filter(s => s.week).map(s => s.week!.n).sort((a, b) => a - b);
  if (week.length && week.join(',') !== '1,2,3,4,5,6,7') err(`week shifts must be numbered 1…7 once each, got ${week.join(',')}`);

  // медицина: копия базы «Анамнеза» (tools/content/anamnez.ts) и своё — записи «по телефону» (tools/content/phone.ts)
  const med = JSON.parse(readFileSync(join(dir, 'med/anamnez.json'), 'utf8')) as ContentDb;
  const phone = buildPhone(dir, med, Object.values(cities), err);
  // учебные звонки — по записям «по телефону»: болезнь, звонящий, место, время внутри смены
  for (const s of Object.values(shifts)) {
    let prev = -1;
    for (const r of s.script) {
      if (!phone.conditions[r.condition]) err(`${s.id}: script ring at ${r.at} has unknown condition ${r.condition}`);
      const k = phone.callers[r.caller];
      if (!k) err(`${s.id}: script ring at ${r.at} has unknown caller ${r.caller}`);
      else if (!k.at.includes(r.where)) err(`${s.id}: ${r.caller} does not call from ${r.where}`);
      if (!(Number.isInteger(r.at) && r.at > prev && r.at < s.length)) err(`${s.id}: script times must go up inside the shift`);
      if (r.first && r.first !== 'clear' && r.first !== 'vague') err(`${s.id}: script ring at ${r.at}: first must be clear or vague`);
      for (const [k, v] of Object.entries(r.params ?? {})) if (med.conditions[r.condition]?.params?.[k]?.[v] === undefined) err(`${s.id}: script ring at ${r.at}: ${k}=${v} is not a parameter of ${r.condition}`);
      prev = r.at;
    }
  }
  return { db: { roads, flow, crews, cities, shifts, phone }, med, errors };
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

export function medText(med: ContentDb): string {
  return [
    '// Сделано tools/content/build.ts из content/med/anamnez.json — руками не править. Подмножество базы «Анамнеза»:',
    '// content/med/FROM.yaml (ADR 0002).',
    "import type { ContentDb } from '../med';",
    '',
    '// строкой через JSON.parse: так тип не выводится из огромного литерала, а Hermes и V8 читают JSON быстрее кода',
    `export const MED: ContentDb = JSON.parse(${JSON.stringify(JSON.stringify(med))});`,
    '',
  ].join('\n');
}

if (import.meta.main) {
  const { db, med, errors } = buildDb();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  if (!process.argv.includes('--check')) {
    mkdirSync(join(ROOT, 'src/content/generated'), { recursive: true });
    writeFileSync(OUT, moduleText(db));
    writeFileSync(MED_OUT, medText(med));
  }
  const p = db.phone;
  const n = Object.keys(db.crews).length + Object.keys(db.cities).length + Object.keys(db.shifts).length + 1 +
    Object.keys(p.findings).length + Object.keys(p.conditions).length + Object.keys(p.questions).length + Object.keys(p.callers).length + Object.keys(p.reasons).length;
  console.log(`содержание: ${n} записей, ошибок нет`);
}
