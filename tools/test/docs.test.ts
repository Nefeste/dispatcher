// Документы (устав, docs/04-process.md): STATUS.md не длиннее 30 строк; относительные ссылки в .md ведут к
// существующим файлам; у каждой ADR проекта — строка в docs/adr/README.md.
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { Glob } from 'bun';

const root = join(import.meta.dir, '../..');

describe('документы', () => {
  test('STATUS.md — не длиннее 30 строк', () => {
    expect(readFileSync(join(root, 'STATUS.md'), 'utf8').trimEnd().split('\n').length).toBeLessThanOrEqual(30);
  });

  test('относительные ссылки ведут к файлам', () => {
    const bad: string[] = [];
    for (const file of new Glob('**/*.md').scanSync({ cwd: root })) {
      if (file.startsWith('node_modules/')) continue;
      for (const m of readFileSync(join(root, file), 'utf8').matchAll(/\]\(([^)\s]+)\)/g)) {
        const href = m[1];
        if (/^(https?:|mailto:|#)/.test(href)) continue;
        const target = normalize(join(root, dirname(file), href.split('#')[0]));
        if (!existsSync(target)) bad.push(`${file}: ${href}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test('каждая ADR — в оглавлении', () => {
    const dir = join(root, 'docs/adr');
    const index = readFileSync(join(dir, 'README.md'), 'utf8');
    const adrs = readdirSync(dir).filter(f => /^\d{4}-.*\.md$/.test(f));
    expect(adrs.filter(f => !index.includes(`(${f})`))).toEqual([]);
  });
});
