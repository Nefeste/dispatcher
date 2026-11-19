// Выгрузка района из OpenStreetMap (ADR 0004): запрос к зеркалу Overpass, ответ — в map-src/<id>.osm.json
// (не в git: это вход сборки, его отпечаток — в паспорте карты). Сеть нужна только здесь.
//
//   bun tools/map/fetch.ts nn-center
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { area, OVERPASS, overpassQuery } from './areas';

const id = process.argv[2] ?? 'nn-center';
const a = area(id);
const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: overpassQuery(a) }) });
if (!res.ok) throw new Error(`Overpass ответил ${res.status}`);
const bytes = new Uint8Array(await res.arrayBuffer());
const dir = join(import.meta.dir, '../../map-src');
mkdirSync(dir, { recursive: true });
const file = join(dir, `${id}.osm.json`);
writeFileSync(file, bytes);
const base = JSON.parse(new TextDecoder().decode(bytes)).osm3s?.timestamp_osm_base;
console.log(`${file}: ${bytes.length} байт, данные OSM на ${base}, sha256 ${createHash('sha256').update(bytes).digest('hex')}`);
