// из shelter: tools/test/i18n.test.ts @ 396daee (оттуда — из skazy и anamnez)
// Все строки для игрока — в src/i18n, тексты содержания — в content/ (AGENTS.md): кириллица в остальном
// коде, кроме комментариев, — ошибка. Корень App.tsx проверяется так же.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Glob } from 'bun';

const SRC = join(import.meta.dir, '../../src');
const CYRILLIC = /[Ѐ-ӿ]/;

/** Код без комментариев; строки и JSX остаются. Переводы строк сохраняются — для номеров строк. */
function stripComments(code: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (quote) {
      out += c;
      if (c === '\\') out += code[++i] ?? '';
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      const body = code.slice(i, end < 0 ? code.length : end + 2);
      out += body.replace(/[^\n]/g, '');
      i += body.length - 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    out += c;
  }
  return out;
}

describe('строки интерфейса', () => {
  test('разбор комментариев', () => {
    expect(stripComments("a // привет\nb /* мир */ c 'строка // не комментарий'")).toBe("a \nb  c 'строка // не комментарий'");
  });

  test('кириллица только в src/i18n и в комментариях', () => {
    const bad: string[] = [];
    for (const file of new Glob('**/*.{ts,tsx}').scanSync(SRC)) {
      if (file.startsWith('i18n/') || file.startsWith('content/generated/')) continue;
      stripComments(readFileSync(join(SRC, file), 'utf8')).split('\n').forEach((line, i) => {
        if (CYRILLIC.test(line)) bad.push(`src/${file}:${i + 1}: ${line.trim()}`);
      });
    }
    for (const line of stripComments(readFileSync(join(SRC, '../App.tsx'), 'utf8')).split('\n')) {
      if (CYRILLIC.test(line)) bad.push(`App.tsx: ${line.trim()}`);
    }
    expect(bad).toEqual([]);
  });
});
