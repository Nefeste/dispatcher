// Файл карты района для пробы Godot: те же байты, что в игре (src/map/generated/nn-center.ts, ADR 0004), — в
// spikes/godot/map/nn-center.bin. Данные: © участники OpenStreetMap, ODbL 1.0.
//
//   bun spikes/godot/tools/export-map.ts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromBase64 } from '../../../src/map/format';
import { MAP_NN_CENTER } from '../../../src/map/generated/nn-center';

const root = join(import.meta.dir, '../../..');
const bytes = fromBase64(MAP_NN_CENTER);
const passport = JSON.parse(readFileSync(join(root, 'assets/map/nn-center.json'), 'utf8'));
const sha = createHash('sha256').update(bytes).digest('hex');
if (sha !== passport.output.sha256) throw new Error('карта не совпадает с паспортом');
writeFileSync(join(import.meta.dir, '../map/nn-center.bin'), bytes);
console.log(`spikes/godot/map/nn-center.bin: ${bytes.length} байт, sha256 ${sha}`);
