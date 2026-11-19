// Сценарий в браузере (спецификация прототипа, критерий 1): веб-сборка, Chromium без окна, настоящие нажатия.
// Сейчас — первый экран → пульт (сцена: карта района на мониторе, телефон и рация) → разговор (звонящий, вопрос,
// решение) → рабочее место (сцена Three.js) → «Об игре» → назад; с каждой частью прототипа путь растёт до сквозного
// (§3).
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

// WebGL без видеокарты — программный SwiftShader через ANGLE: без флагов Chromium без окна сцену не покажет
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
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

  // пульт (ADR 0009): карта района на мониторе, на ней указание OpenStreetMap; сдвиг мышью не роняет её
  await page.getByTestId('title-map').click();
  await see(page, 'pult');
  await see(page, 'map-view');
  await see(page, 'map-osm', '© участники OpenStreetMap');
  await page.waitForTimeout(800);
  await snap(page, 'map');
  const box = (await page.getByTestId('map-view').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 200, { steps: 12 });
  await page.mouse.up();
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(500);
  await snap(page, 'map-moved');
  // часы смены ставят паузу; телефон на столе принимает звонок
  await page.getByTestId('pult-clock').click();
  await page.getByTestId('pult-phone').click();
  await see(page, 'call');
  await page.waitForTimeout(800);
  await snap(page, 'call');
  await page.getByTestId('call-q-1').click();
  await page.getByTestId('call-q-0').click();
  await page.waitForTimeout(300);
  if (!(await page.getByTestId('call-q-1').isDisabled())) throw new Error('заданный вопрос нажимается снова');
  await snap(page, 'call-asked');
  // решение — видеовставка «бригада выезжает»: ролик или кадр вместо него, потом снова пульт
  await page.getByTestId('call-form-emergency').click();
  await see(page, 'insert');
  await page.waitForTimeout(2500);
  const video = await page.locator('video').count();
  console.log(`вставка: ${video ? 'ролик' : 'кадр вместо ролика'}`);
  await snap(page, 'insert');
  await page.getByTestId('pult').waitFor({ state: 'visible', timeout: 15000 });
  checks++;
  // П3: часы идут ×4 — посланная бригада едет по улицам и докладывает по рации
  await page.getByTestId('pult-clock').click();
  await page.getByTestId('pult-speed').click();
  await page.getByTestId('pult-speed').click();
  await page.waitForTimeout(3000);
  await snap(page, 'pult-crews');
  await page.getByTestId('map-back').click();
  await see(page, 'title-name');

  // рабочее место: модель из Blender на Three.js, экраны мониторов — Skia; палец поворачивает взгляд
  await page.getByTestId('title-desk').click();
  await see(page, 'desk-gl');
  await page.getByTestId('desk-ready').waitFor({ state: 'visible', timeout: 90000 });
  await see(page, 'desk-ready', 'оглядеться');
  await see(page, 'desk-fps', 'к/с');
  await page.waitForTimeout(1500);
  await snap(page, 'desk');
  const gl = (await page.getByTestId('desk-gl').boundingBox())!;
  await page.mouse.move(gl.x + gl.width / 2, gl.y + gl.height / 2);
  await page.mouse.down();
  await page.mouse.move(gl.x + gl.width / 2 + 150, gl.y + gl.height / 2 - 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
  await snap(page, 'desk-look');
  await page.getByTestId('desk-back').click();
  await see(page, 'title-name');

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
