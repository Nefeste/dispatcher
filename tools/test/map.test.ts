// Карта (ADR 0004; docs/02-architecture.md, §5, §8): файл читается тем же модулем, что пишет; паспорт сходится с
// файлом в сборке; если выгрузка лежит рядом (map-src/, не в git), сборка из неё повторяет файл байт в байт.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fromBase64, readMap, writeMap } from '../../src/map/format';
import { MAP_NN_CENTER } from '../../src/map/generated/nn-center';
import { area } from '../map/areas';
import { build, moduleText } from '../map/build';

const root = join(import.meta.dir, '../..');
const passport = JSON.parse(readFileSync(join(root, 'assets/map/nn-center.json'), 'utf8'));

describe('карта nn-center', () => {
  const bytes = fromBase64(MAP_NN_CENTER);

  test('паспорт: отпечаток и размер — у файла в сборке; лицензия ODbL и указание OpenStreetMap', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(passport.output.sha256);
    expect(bytes.length).toBe(passport.output.bytes);
    expect(passport.licence).toBe('ODbL-1.0');
    expect(passport.attribution).toContain('OpenStreetMap');
    expect(passport.source.osmBase).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  test('чтение и запись — туда и обратно байт в байт', () => {
    expect(Buffer.from(writeMap(readMap(bytes))).equals(Buffer.from(bytes))).toBe(true);
  });

  test('base64 — как у Buffer', () => {
    for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'Диспетчер 03']) {
      const b = new TextEncoder().encode(s);
      expect([...fromBase64(Buffer.from(b).toString('base64'))]).toEqual([...b]);
    }
  });

  test('форма каждого ребра начинается и кончается в его узлах; координаты — в рамке района', () => {
    const m = readMap(bytes);
    const { starts, pts } = m.edges.shape;
    for (let e = 0; e < m.edges.a.length; e++) {
      const s0 = starts[e] * 2, s1 = (starts[e + 1] - 1) * 2;
      expect([pts[s0], pts[s0 + 1]]).toEqual([m.nodes.x[m.edges.a[e]], m.nodes.y[m.edges.a[e]]]);
      expect([pts[s1], pts[s1 + 1]]).toEqual([m.nodes.x[m.edges.b[e]], m.nodes.y[m.edges.b[e]]]);
    }
    for (const l of [m.edges.shape, m.water, m.green, m.rail]) {
      for (let i = 0; i < l.pts.length; i += 2) {
        expect(l.pts[i]).toBeLessThanOrEqual(m.width);
        expect(l.pts[i + 1]).toBeLessThanOrEqual(m.height);
      }
    }
  });

  const src = join(root, 'map-src/nn-center.osm.json');
  test.skipIf(!existsSync(src))('сборка из выгрузки повторяет файл байт в байт (если выгрузка есть)', () => {
    const raw = readFileSync(src, 'utf8');
    if (createHash('sha256').update(raw).digest('hex') !== passport.source.sha256) return;
    const out = build(area('nn-center'), raw);
    expect(Buffer.from(out.bytes).equals(Buffer.from(bytes))).toBe(true);
    expect(readFileSync(join(root, 'src/map/generated/nn-center.ts'), 'utf8')).toBe(moduleText('nn-center', out.bytes));
  });
});
