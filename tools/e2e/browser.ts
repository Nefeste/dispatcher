// Сценарий в браузере (спецификация прототипа, критерий 1): веб-сборка, Chromium без окна, настоящие нажатия.
// Сейчас (П1) — первый экран → «Об игре» → назад; с каждой частью прототипа путь растёт до сквозного (§3).
// Снимки — tools/e2e/out/. Ошибка в консоли — провал. По образцу shelter: tools/e2e/browser.ts @ 396daee.
//
//   npm run export:web && NODE_PATH=/opt/node22/lib/node_modules bun tools/e2e/browser.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';

const ROOT = join(import.meta.dir, '../..');
const DIST = join(ROOT, process.env.E2E_DIST ?? 'dist-web');
const OUT = join(import.meta.dir, 'out');
mkdirSync(OUT, { recursive: true });

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file(join(DIST, path === '/' ? 'index.html' : path));
    return (await file.exists()) ? new Response(file) : new Response(Bun.file(join(DIST, 'index.html')));
  },
});

const errors: string[] = [];
let shot = 0;
let checks = 0;
const snap = async (p: Page, name: string) => p.screenshot({ path: join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`) });
const see = async (p: Page, id: string, text?: string) => {
  const el = p.getByTestId(id);
  await el.waitFor({ state: 'visible', timeout: 15000 });
  if (text !== undefined) {
    const got = (await el.innerText()).replace(/\s+/g, ' ');
    if (!got.includes(text)) throw new Error(`${id}: ждали «${text}», на экране «${got}»`);
  }
  checks++;
};

const browser = await chromium.launch();
try {
  // телефон в портрете (ADR 0006); снимки для людей — с плотностью 2
  const page = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${server.port}/`);

  await see(page, 'title-name', 'Диспетчер 03');
  await see(page, 'title-not-training', 'Это игра. Если нужна помощь');
  await see(page, 'title-start', 'Начать смену');
  if (!(await page.getByTestId('title-start').isDisabled())) throw new Error('«Начать смену» нажимается, а смены ещё нет');
  await snap(page, 'title');

  await page.getByTestId('title-about').click();
  await see(page, 'about-not-training', 'звоните 103 или 112');
  await see(page, 'about-osm', '© участники OpenStreetMap');
  await see(page, 'about-version', 'Версия');
  await snap(page, 'about');

  await page.getByTestId('about-back').click();
  await see(page, 'title-name');

  if (errors.length) throw new Error(`ошибки в консоли:\n${errors.join('\n')}`);
  console.log(`сценарий пройден: ${checks} проверок, ${shot} снимков в ${OUT}`);
} finally {
  await browser.close();
  server.stop(true);
}
