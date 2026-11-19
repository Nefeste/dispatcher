// Медицина (часть П4; ADR 0002; docs/09-content.md, «Проверки»): копии «Анамнеза» сходятся с content/med/FROM.yaml
// байт в байт; у скопированного кода — строка источника с тем же коммитом; больной рождается для каждой из 12 болезней,
// и каждый его признак — от причины (ADR 0009 «Анамнеза»).
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse } from 'yaml';
import { MED } from '../../src/content/generated/med';
import { generatePatient } from '../../src/engine/med/generate';

const root = join(import.meta.dir, '../..');
const MEDDIR = join(root, 'content/med');
const from = parse(readFileSync(join(MEDDIR, 'FROM.yaml'), 'utf8')) as {
  anamnez: string; bundle: { file: string; sha256: string }; files: { path: string; sha256: string }[];
};
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const walk = (d: string): string[] => readdirSync(d).flatMap(n => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const SELECT = (parse(readFileSync(join(MEDDIR, 'select.yaml'), 'utf8')) as { conditions: string[] }).conditions;

describe('копия «Анамнеза»', () => {
  test('каждая копия — байт в байт по FROM.yaml, и других файлов нет', () => {
    for (const f of from.files) expect(`${f.path} ${sha(join(MEDDIR, f.path))}`).toBe(`${f.path} ${f.sha256}`);
    expect(sha(join(MEDDIR, from.bundle.file))).toBe(from.bundle.sha256);
    const listed = new Set([...from.files.map(f => f.path), from.bundle.file, 'FROM.yaml', 'select.yaml']);
    expect(walk(MEDDIR).map(p => relative(MEDDIR, p)).filter(p => !listed.has(p))).toEqual([]);
  });

  test('собранная база — это content/med/anamnez.json', () => {
    expect(MED).toEqual(JSON.parse(readFileSync(join(MEDDIR, 'anamnez.json'), 'utf8')));
    for (const id of SELECT) expect(MED.conditions[id]).toBeDefined();
  });

  test('скопированный код — со строкой источника на коммит FROM.yaml', () => {
    const files = [...walk(join(root, 'src/engine/core')), ...walk(join(root, 'src/engine/med')), join(root, 'src/content/med.ts'), join(root, 'tools/content/brands.ts')];
    for (const f of files) {
      const first = readFileSync(f, 'utf8').split('\n')[0];
      const m = /^\/\/ из anamnez: (\S+) @ ([0-9a-f]{7,40})/.exec(first);
      expect(m, relative(root, f)).not.toBeNull();
      expect(from.anamnez.startsWith(m![2])).toBe(true);
    }
  });
});

describe('больной', () => {
  test('для каждой болезни: она основная, признаки — от причины, тот же зерно — тот же больной', () => {
    for (const id of SELECT) {
      for (let seed = 1; seed <= 30; seed++) {
        const ctx = { primary: id, department: MED.conditions[id].department, season: 'autumn' as const };
        const p = generatePatient(MED, seed * 101, ctx);
        expect(p.truth.conditions[0].id).toBe(id);
        const causes = new Set<string>([...p.truth.conditions.map(c => c.id), ...p.truth.risks, 'leak']);
        for (const f of p.truth.findings) {
          expect(MED.findings[f.f]).toBeDefined();
          expect(causes.has(f.cause)).toBe(true);
        }
        expect(generatePatient(MED, seed * 101, ctx)).toEqual(p);
      }
    }
  });
});
