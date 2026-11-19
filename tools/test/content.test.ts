// Сборка содержания (docs/04-data-model.md, §1; docs/09-content.md, «Проверки»): собранный модуль — тот, что дают
// записи; проверки ловят точку вдали от дорог, имя настоящего учреждения и неизвестную бригаду.
import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDb, moduleText } from '../content/build';

const root = join(import.meta.dir, '../..');

describe('содержание', () => {
  test('записи без ошибок; собранный модуль — тот, что дают записи', () => {
    const { db, errors } = buildDb();
    expect(errors).toEqual([]);
    expect(readFileSync(join(root, 'src/content/generated/db.ts'), 'utf8')).toBe(moduleText(db));
  });

  test('подстанции и больницы привязаны к дорогам, имена — вымышленные', () => {
    const { db } = buildDb();
    const city = db.cities['city.proto'];
    expect(city.bases.length).toBeGreaterThanOrEqual(2);
    expect(city.hospitals.length).toBeGreaterThanOrEqual(3);
    for (const k of Object.values(db.crews)) {
      expect(k.sources.length).toBeGreaterThan(0);
      expect(k.review).toBe('draft');
    }
  });

  test('проверки ловят ошибки', () => {
    const dir = mkdtempSync(join(tmpdir(), 'content-'));
    try {
      cpSync(join(root, 'content'), dir, { recursive: true });
      const city = readFileSync(join(dir, 'cities/proto.yaml'), 'utf8')
        .replace('Городская больница № 63', 'Городская больница №4')
        .replace('at: [2600, 9200]', 'at: [-4000, -4000]');
      writeFileSync(join(dir, 'cities/proto.yaml'), city);
      const shift = readFileSync(join(dir, 'shifts/proto.yaml'), 'utf8').replace('kind: crew.resus', 'kind: crew.nope');
      writeFileSync(join(dir, 'shifts/proto.yaml'), shift);
      const { errors } = buildDb(dir);
      expect(errors.some(e => e.includes('real institution'))).toBe(true);
      expect(errors.some(e => e.includes('from the nearest road'))).toBe(true);
      expect(errors.some(e => e.includes('unknown kind'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
