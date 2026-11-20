// Сценарий в браузере (спецификация прототипа, критерий 1): веб-сборка, Chromium без окна, настоящие нажатия.
// Сейчас — первый экран → «Первая неделя» → выбор смены → пульт (карта района, автопауза на звонке) → разговор (вопросы по вкладкам,
// решение, бригада) → видеовставка → вся смена до конца (звонки, ожидание, доклады бригад, выбор больницы) → итог →
// разбор (главная ошибка, вызов: по известному и по правде) → рабочее место (сцена Three.js) → «Об игре» → назад;
// к П8 путь растёт до сквозного (§3).
// Снимки — tools/e2e/out/. Ошибка в консоли — провал. По образцу shelter: tools/e2e/browser.ts @ 396daee.
//
//   npm run export:web && NODE_PATH=/opt/node22/lib/node_modules bun tools/e2e/browser.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { newShift, shiftCtx } from '../../src/engine/shift';
import { loadMap } from '../../src/map/load';
import { fitOf } from '../../src/ui/map/scale';

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
  // часы смены — в 20 раз быстрее ×1: смена проходится за минуты (src/state/session.ts, setPace)
  // «Замер» — короткий (bench=quick): сцены по секунде, десять поисков
  await page.goto(`http://localhost:${server.port}/?pace=20&bench=quick`);

  await see(page, 'title-name', 'Диспетчер 03');
  await see(page, 'title-not-training', 'Это игра. Если нужна помощь');
  await see(page, 'title-start', 'Первая неделя');
  await snap(page, 'title');

  // настройки: переключатели пишутся сразу
  await page.getByTestId('title-settings').click();
  await see(page, 'settings-sound', 'Звук');
  await page.getByTestId('settings-haptics').click();
  await page.getByTestId('settings-haptics').click();
  await snap(page, 'settings');
  await page.getByTestId('settings-back').click();
  await see(page, 'title-start');

  // смена: загрузка с ходом полосы → вставка «начало смены» (касание пропускает) → пульт с вводом поверх карты; часы
  // стоят, пока ввод не закрыт
  await page.getByTestId('title-start').click();
  // выбор смены «Первой недели» (срез, часть С1): открыта только первая
  await see(page, 'week', 'Понедельник, утро');
  await see(page, 'week-2', 'Откроется после смены 1');
  await snap(page, 'week');
  await page.getByTestId('week-1').click();
  await see(page, 'insert');
  await page.waitForTimeout(1500);
  await snap(page, 'insert-start');
  await page.getByTestId('insert').click();
  await see(page, 'pult');
  await see(page, 'intro', 'диспетчер скорой');
  await page.waitForTimeout(500);
  await snap(page, 'intro');
  await page.getByTestId('intro-go').click();
  await see(page, 'map-view');
  await see(page, 'map-osm', '© участники OpenStreetMap');
  const box = (await page.getByTestId('map-view').boundingBox())!;
  // касание знака бригады на подстанции — карточка бригады (#26): карта ещё как при открытии, район в окне целиком
  {
    const ctx = shiftCtx(DB, MED, 'shift.proto', loadMap(DB.cities['city.proto'].map));
    const m = ctx.map;
    const fit = fitOf(m, box.width, box.height);
    const clampPan = (v: number, size: number, view: number) => (size * fit <= view ? (view - size * fit) / 2 : Math.min(0, Math.max(view - size * fit, v)));
    const tx = clampPan((box.width - m.width * fit) / 2, m.width, box.width);
    const ty = clampPan((box.height - m.height * fit) / 2, m.height, box.height);
    // знак ниже строки подсказки и дальше от краёв
    const spots = newShift(ctx, 1).crews
      .map(c => ({ x: box.x + tx + m.nodes.x[c.at] * fit, y: box.y + ty + m.nodes.y[c.at] * fit }))
      .filter(p => p.x > box.x + 30 && p.x < box.x + box.width - 30 && p.y > box.y + 120 && p.y < box.y + box.height - 40);
    if (!spots.length) throw new Error('на открытой карте нет знака бригады, куда коснуться');
    await page.mouse.click(spots[0].x, spots[0].y);
    await see(page, 'crew-card', 'Бригада');
    await see(page, 'crew-card', 'На подстанции');
    await snap(page, 'crew-card');
    await page.getByTestId('crew-card-close').click();
  }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2 - 80, { steps: 8 });
  await page.mouse.up();
  // первый учебный звонок: автопауза, на линии — один
  // подписи пульта читаются без ожидания: смена может кончиться между проверкой экрана и чтением — тогда пульта уже нет
  const label = (id: string) => page.getByTestId(id).getAttribute('aria-label', { timeout: 1500 }).catch(() => null);
  const speed = async () => /Скорость смены: (.+)/.exec((await label('pult-speed')) ?? '')?.[1] ?? null;
  const line = async () => Number(/на линии (\d+)/.exec((await label('pult-phone')) ?? '')?.[1] ?? 0);
  for (let i = 0; i < 100 && (await line()) === 0; i++) await page.waitForTimeout(100);
  if ((await line()) !== 1) throw new Error('первый звонок не пришёл');
  if ((await speed()) !== 'пауза') throw new Error(`звонок не поставил паузу: ${await speed()}`);
  await see(page, 'hint', 'коснитесь телефона');
  await snap(page, 'pult-ring');
  checks++;

  // разговор: вопросы — по вкладкам, каждый двигает часы на свою цену; решение — форма, потом бригада
  // первый учебный звонок (§3, шаг 4): подсказки ведут — спросить, как дышит, экстренная, ближайшая бригада
  await page.getByTestId('pult-phone').click();
  await see(page, 'call');
  await see(page, 'hint', 'спросите, как дышит');
  await page.waitForTimeout(500);
  await snap(page, 'call');
  await page.getByTestId('call-q-q.breathing').click();
  await see(page, 'hint', '«Экстренная»');
  await page.getByTestId('call-tab-who').click();
  await page.getByTestId('call-q-q.age').click();
  await page.waitForTimeout(300);
  await snap(page, 'call-asked');
  await page.getByTestId('call-form-emergency').click();
  await see(page, 'hint', 'ближайшей бригаде');
  await see(page, 'call-crews', 'Кого послать');
  await snap(page, 'call-crews');
  await page.getByTestId('call-crew-0').click();
  // первый выезд — видеовставка «бригада выезжает»: ролик или кадр вместо него, потом снова пульт
  await see(page, 'insert');
  await page.waitForTimeout(2500);
  const video = await page.locator('video').count();
  console.log(`вставка: ${video ? 'ролик' : 'кадр вместо ролика'}`);
  await snap(page, 'insert');
  await page.getByTestId('pult').waitFor({ state: 'visible', timeout: 15000 });
  checks++;
  await page.waitForTimeout(1500);
  await snap(page, 'pult-crews');

  // дальше — вся смена до конца: звонки, ожидание, доклады бригад, выбор больницы (часы ускорены: ?pace=)
  const visible = async (id: string) => (await page.getByTestId(id).count()) > 0 && page.getByTestId(id).first().isVisible();
  // экран живой: часы идут, строки пересобираются — касание, которое не успело, просто повторится на следующем шаге
  const tap = (id: string) => page.getByTestId(id).first().click({ timeout: 1500 }).then(() => true, () => false);
  let calls = 1, reports = 0, held = 0, picked = 0, shotReport = false, shotWaiting = false, lastTile = 0;
  for (let i = 0; i < 3000; i++) {
    if (await visible('end')) break;
    if (await visible('report')) {
      if (!shotReport) { await snap(page, 'report'); shotReport = true; }
      if (await tap('report-h-0')) reports++;
    } else if (await visible('call-crews')) {
      // каждый третий — подождёт: потом его пошлют с пульта
      if (calls % 3 === 0 || !(await visible('call-crew-0'))) { if (await tap('call-hold')) held++; }
      else await tap('call-crew-0');
    } else if (await visible('call')) {
      await tap('call-q-q.conscious');
      await tap('call-q-q.breathing');
      if (await tap(calls % 2 ? 'call-form-urgent' : 'call-form-emergency')) calls++;
    } else if (await visible('insert')) {
      await page.waitForTimeout(200);
    } else if (await visible('crews')) {
      if (!shotWaiting) { await snap(page, 'pult-waiting'); shotWaiting = true; }
      if (await visible('crews-0')) { if (await tap('crews-0')) picked++; }
      else await tap('crews-close');
    } else if (await visible('pult')) {
      const now = await speed();
      if ((await line()) > 0) await tap('pult-phone');
      else if (now === 'пауза') await tap('pult-clock');
      else if (now === '×1') await tap('pult-speed');
      else if (Date.now() - lastTile > 2000 && (await visible('pult-waiting-0'))) { lastTile = Date.now(); await tap('pult-waiting-0'); }
      else await page.waitForTimeout(150);
    } else await page.waitForTimeout(100);
  }
  await see(page, 'end-emergency', 'Экстренные с доездом до 20 минут');
  console.log(`смена: ${calls} звонков, ${reports} докладов с больницей, ${held} ждали, ${picked} посланы с пульта`);
  // послать с пульта удаётся, только когда свободна бригада, — это не всегда; звонки и доклады — всегда
  // первая смена недели — учебная, поток вполовину (§8 геймдизайна): около девяти звонков
  if (calls < 7 || reports < 1) throw new Error('смена прошла не вся');
  await see(page, 'review-main', 'Главная ошибка');
  await snap(page, 'review');
  // снимок смены: в браузере — скачивается картинкой
  const download = page.waitForEvent('download', { timeout: 15000 });
  await page.getByTestId('end-snapshot').click();
  const file = await download;
  await file.saveAs(join(OUT, `${String(++shot).padStart(2, '0')}-snapshot.png`));
  await see(page, 'end-snapshot-done', 'Снимок готов');
  // разбор вызова: разговор, решение, по известному и по правде — отдельно
  if (await visible('review-main-call')) await page.getByTestId('review-main-call').click();
  else await page.getByTestId('review-row-1').click();
  await see(page, 'call-review-known', 'По известному');
  await see(page, 'call-review-truth', 'По правде');
  await snap(page, 'call-review');
  await page.getByTestId('call-review-back').click();
  await see(page, 'review-main');
  // «К неделе»: первая смена пройдена — вторая открыта, у первой — лучший итог
  await page.getByTestId('end-home').click();
  await see(page, 'week-1', 'Лучший итог');
  await see(page, 'week-2', 'Понедельник, вечер');
  await snap(page, 'week-after');
  await page.getByTestId('week-back').click();
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

  // «Замер» (§8): карта сама двигается и приближается, смена идёт на пульте, поиски пути; итог — текстом, с загрузкой
  // смены, которую сценарий прошёл выше
  await page.getByTestId('title-bench').click();
  await see(page, 'bench-run', 'Начать замер');
  await page.getByTestId('bench-run').click();
  await see(page, 'bench-running', 'сдвиг карты');
  await page.waitForTimeout(600);
  await snap(page, 'bench-pan');
  await page.getByTestId('bench-running').filter({ hasText: 'смена на пульте' }).waitFor({ state: 'visible', timeout: 20000 });
  await page.waitForTimeout(700);
  await snap(page, 'bench-pult');
  await page.getByTestId('bench-result').waitFor({ state: 'visible', timeout: 60000 });
  await see(page, 'bench-result', 'Замер «Диспетчера 03»');
  await see(page, 'bench-result', 'Поиск пути по району');
  await see(page, 'bench-result', 'Загрузка смены: от выбора смены до готовности');
  console.log((await page.getByTestId('bench-result').innerText()).split('\n').map(l => `  ${l}`).join('\n'));
  await snap(page, 'bench');
  checks++;
  await page.getByTestId('bench-back').click();
  await see(page, 'title-name');

  if (errors.length) throw new Error(`ошибки в консоли:\n${errors.join('\n')}`);
  console.log(`сценарий пройден: ${checks} проверок, ${shot} снимков в ${OUT}`);
} finally {
  await browser.close();
  server.stop(true);
}
