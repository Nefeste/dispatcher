// Сборка содержания (docs/04-data-model.md, §1; docs/09-content.md, «Проверки»): собранный модуль — тот, что дают
// записи; проверки ловят точку вдали от дорог, имя настоящего учреждения и неизвестную бригаду.
import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDb, medText, moduleText } from '../content/build';

const root = join(import.meta.dir, '../..');

describe('содержание', () => {
  test('записи без ошибок; собранный модуль — тот, что дают записи', () => {
    const { db, med, errors } = buildDb();
    expect(errors).toEqual([]);
    expect(readFileSync(join(root, 'src/content/generated/db.ts'), 'utf8')).toBe(moduleText(db));
    expect(readFileSync(join(root, 'src/content/generated/med.ts'), 'utf8')).toBe(medText(med));
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
      // записи «по телефону»
      const f = join(dir, 'phone/findings/sym.face_droop.yaml');
      writeFileSync(f, readFileSync(f, 'utf8').replace('threat: "388n, п. 11, вводная часть"', 'threat: "928n"'));
      const g = join(dir, 'phone/findings/sym.hives.yaml');
      writeFileSync(g, readFileSync(g, 'utf8').replace('sources: ["anamnez"]', 'sources: ["wiki"]'));
      const q = join(dir, 'questions/seizure.yaml');
      writeFileSync(q, readFileSync(q, 'utf8').replace('opens: [sym.seizure, sym.seizure_ongoing]', 'opens: [sym.seizure, sym.seizure_ongoing, sym.nope]'));
      rmSync(join(dir, 'phone/conditions/cond.influenza.yaml'));
      // звонящие разные (срез, С7): два варианта слов у признака и у строк звонящего — мало
      const w = join(dir, 'phone/findings/sym.cough.yaml');
      writeFileSync(w, readFileSync(w, 'utf8').replace('self: ["Кашляю", "Кашель у меня", "Кашляю, не перестаю"]', 'self: ["Кашляю", "Кашель у меня"]'));
      const k = join(dir, 'callers/self.yaml');
      writeFileSync(k, readFileSync(k, 'utf8').replace('nothing: ["Да больше ничего, всё сказал{|а}", "Больше ничего", "Всё, вроде больше нет"]', 'nothing: ["Больше ничего"]'));
      const r = join(dir, 'reasons/hip.yaml');
      writeFileSync(r, readFileSync(r, 'utf8').replace('встать не может', 'встать не может, дали аспирин'));
      const { errors } = buildDb(dir);
      expect(errors.some(e => e.includes('threat must cite 388n'))).toBe(true);
      expect(errors.some(e => e.includes('unknown source key «wiki»'))).toBe(true);
      expect(errors.some(e => e.includes('opens sym.nope'))).toBe(true);
      expect(errors.some(e => e.includes('cond.influenza: in content/med/select.yaml but has no phone record'))).toBe(true);
      expect(errors.some(e => e.includes('brand name'))).toBe(true);
      expect(errors.some(e => e.includes('real institution'))).toBe(true);
      expect(errors.some(e => e.includes('from the nearest road'))).toBe(true);
      expect(errors.some(e => e.includes('unknown kind'))).toBe(true);
      expect(errors.some(e => e.includes('sym.cough: says.present.self needs at least 3 wordings, has 2'))).toBe(true);
      expect(errors.some(e => e.includes('caller.self: nothing needs at least 3 wordings, has 1'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
