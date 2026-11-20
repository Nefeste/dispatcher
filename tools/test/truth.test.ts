// Экраны не читают правду о больном (спецификация прототипа, критерий 3; ADR 0005): src/screens, src/scenes и src/ui
// не берут из движка ни больного, ни звонящего, ни разбора, ни формы по правде и не трогают поле `truth`. Правду
// открывают только виды в src/state: вызов (callView) — сказанное звонящим, разбор закрытой смены (reviewView) —
// всё. Так же устроен src/state/caseView.ts «Анамнеза».
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';

const SRC = join(import.meta.dir, '../../src');
// станция (срез, С2) — тоже через вид: экран станции знает только итоги смен (src/state/stationView.ts)
const FORBIDDEN = [/engine\/med\//, /engine\/callers/, /engine\/review/, /engine\/form/, /engine\/talk/, /engine\/station/, /content\/generated\/med/];

describe('экраны не видят правды', () => {
  test('ни импорта больного и разбора, ни поля truth', () => {
    const bad: string[] = [];
    for (const dir of ['screens', 'scenes', 'ui']) {
      for (const file of new Glob('**/*.{ts,tsx}').scanSync(join(SRC, dir))) {
        const code = readFileSync(join(SRC, dir, file), 'utf8');
        for (const m of code.matchAll(/from '([^']+)'/g)) if (FORBIDDEN.some(r => r.test(m[1]))) bad.push(`${dir}/${file}: ${m[1]}`);
        if (/\.truth\b/.test(code)) bad.push(`${dir}/${file}: .truth`);
      }
    }
    expect(bad).toEqual([]);
  });
});
