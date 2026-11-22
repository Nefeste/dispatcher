// из durak: tools/test/store.test.ts @ 772c405 — без товаров RuStore Pay (денег пока нет, #46), с предзаказом и строкой 103/112
// Карточка RuStore (store/README.md): длины текстов в пределах магазина, частые вопросы — не больше десяти, снимки —
// не больше десяти, 1080 × 1920, первые — те же, что на странице сайта; графика — нужных размеров.
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

/** Разделы файла: «## Заголовок» → текст под ним. */
function sections(file: string, mark = '## '): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of readFileSync(file, 'utf8').split(new RegExp(`^${mark}`, 'm')).slice(1)) {
    const [title, ...body] = part.split('\n');
    out.set(title.trim(), body.join('\n').trim());
  }
  return out;
}

/** Ширина и высота PNG из блока IHDR (байты 16–23). */
const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];

describe('карточка RuStore', () => {
  test('все разделы есть, длины в пределах', () => {
    const s = sections('store/listing.ru.md');
    const limits: [string, number][] = [['Название', 50], ['Краткое описание', 80], ['Полное описание', 4000], ['Что нового', 500]];
    for (const [title, max] of limits) {
      const text = s.get(title);
      expect(text, `нет раздела «${title}»`).toBeDefined();
      expect(text!.length, `«${title}»: ${text!.length} знаков`).toBeLessThanOrEqual(max);
      expect(text!.length).toBeGreaterThan(0);
    }
    expect(s.get('Ключевые слова')).toBeDefined();
  });

  // ADR 0007: заглавный экран, «Об игре» и карточка магазина несут эту строку
  test('полное описание и страница сайта говорят «Это игра» и номера 103 и 112', () => {
    expect(sections('store/listing.ru.md').get('Полное описание')).toContain('Это игра. Если нужна помощь — звоните 103 или 112.');
    expect(readFileSync('store/site/page.ru.md', 'utf8')).toContain('Если нужна помощь — звоните 103 или 112.');
  });

  test('частые вопросы: не больше 10, вопрос до 120 знаков, ответ до 500', () => {
    expect(readFileSync('store/faq.ru.md', 'utf8')).toMatch(/^## Карточка RuStore$/m);
    const faq = [...sections('store/faq.ru.md', '### ')];
    expect(faq.length).toBeGreaterThan(0);
    expect(faq.length).toBeLessThanOrEqual(10);
    for (const [q, a] of faq) {
      expect(q.length, q).toBeLessThanOrEqual(120);
      expect(a.length, `${q}: ${a.length} знаков`).toBeLessThanOrEqual(500);
      expect(a.length, q).toBeGreaterThan(0);
    }
  });

  test('снимки для карточки: не больше десяти, первые — те же, что на странице сайта, 1080 × 1920 и меньше 5 МБ', () => {
    const readme = readFileSync('store/README.md', 'utf8').split(/^## Снимки для карточки$/m)[1].split(/^## /m)[0];
    const card = [...readme.matchAll(/^\d+\. `([^`]+\.png)`/gm)].map(m => m[1]);
    expect(card.length).toBeGreaterThan(0);
    expect(card.length).toBeLessThanOrEqual(10);
    expect(new Set(card).size).toBe(card.length);
    const site = [...readFileSync('store/site/page.ru.md', 'utf8').matchAll(/^ {2}- file: screenshots\/ru\/(\S+)$/gm)].map(m => m[1]);
    expect(card.slice(0, site.length)).toEqual(site);
    for (const f of card) {
      const path = `store/screenshots/ru/${f}`;
      expect(existsSync(path), f).toBe(true);
      const png = readFileSync(path);
      expect(size(png), f).toEqual([1080, 1920]);
      expect(png.length, f).toBeLessThan(5 * 1024 * 1024);
    }
  });

  test('графика: значок 512, баннер 1024 × 500, картинка для ссылок 1200 × 630', () => {
    const want: [string, number[]][] = [['icon-512.png', [512, 512]], ['feature-1024x500.png', [1024, 500]], ['og-1200x630.png', [1200, 630]]];
    for (const [f, wh] of want) expect(size(readFileSync(`store/graphics/${f}`)), f).toEqual(wh);
  });
});
