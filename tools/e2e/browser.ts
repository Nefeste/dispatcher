// Сценарий в браузере (спецификация прототипа, критерий 1): веб-сборка, Chromium без окна, настоящие нажатия.
// Сейчас — первый экран → «Первая неделя» → выбор смены → пульт (карта района, автопауза на звонке) → разговор (вопросы по вкладкам,
// решение, бригада) → видеовставка → вся смена до конца (звонки, ожидание, доклады бригад, выбор больницы) → итог →
// разбор (главная ошибка, вызов: по известному и по правде) → станция (письмо, журнал, табель, укладки, решение) →
// неделя → рабочее место (сцена Three.js) → «Об игре» → «Сообщить об ошибке» → назад; экран сбоя (`?crash=1`);
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
import { afterShift, decide, lineupOf, newStation, reportOf } from '../../src/engine/station';
import { KEYS } from '../../src/state/storage';
import { weekShifts } from '../../src/state/week';
import { addEntry, entryOf, newWeekLog } from '../../src/state/weekLog';
import { BOTS, play } from '../sim/bots';
import { policyMoves } from '../sim/week';
import { loadMap } from '../../src/map/load';
import { fitOf } from '../../src/ui/map/scale';

const ROOT = join(import.meta.dir, '../..');
const DIST = join(ROOT, process.env.E2E_DIST ?? 'dist-web');
// E2E_OUT, E2E_VIEW — другая папка и окно: снимки магазина 9 : 16 (`E2E_VIEW=432x768x2.5` → 1080 × 1920, tools/store/shots.ts)
const OUT = process.env.E2E_OUT ?? join(import.meta.dir, 'out');
const [VW, VH, VS] = (process.env.E2E_VIEW ?? '412x915x2').split('x').map(Number);
mkdirSync(OUT, { recursive: true });

const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const path = new URL(req.url).pathname;
    const file = Bun.file(join(DIST, path === '/' ? 'index.html' : path));
    return (await file.exists()) ? new Response(file) : new Response(Bun.file(join(DIST, 'index.html')));
  },
});

/** Неделя «виртуального диспетчера» «по правилам» с лучшими решениями станции — строками хранилища телефона после
 *  каждой смены: станция, журнал недели, лучшие итоги (срез, С8). Сценарий сам играет первую смену; остальные шесть — за
 *  него движок: те же функции, что у телефона, поэтому строки — те, что телефон записал бы сам. */
function weekStorage(): Record<string, string>[] {
  const map = loadMap(DB.cities['city.proto'].map);
  let st = newStation();
  let log = newWeekLog(map.id, map.edges.a.length);
  const best: Record<string, { emergency: number; inNorm: number; urgentMedian: number | null; accepted: number }> = {};
  const week = weekShifts();
  return week.map((sh, i) => {
    const ctx = shiftCtx(DB, MED, sh.id, map);
    const { s } = play(ctx, 900 + i, BOTS.rules, lineupOf(st));
    const rep = reportOf(ctx, s);
    st = afterShift(st, rep);
    log = addEntry(log, map.id, map.edges.a.length, entryOf(ctx, s, rep));
    best[sh.id] = { emergency: rep.emergency, inNorm: rep.inNorm, urgentMedian: null, accepted: s.calls.length };
    for (const d of policyMoves(st, week[i + 1]?.id ?? null, 'best')) {
      const y = decide(st, d);
      if (typeof y !== 'string') st = y;
    }
    return { [KEYS.station]: JSON.stringify(st), [KEYS.week]: JSON.stringify(log), [KEYS.progress]: JSON.stringify({ best: { ...best } }) };
  });
}
const WEEK = weekStorage();

const errors: string[] = [];
let shot = 0;
let checks = 0;
/** Текст кнопок — внутри кнопки (игра владельца 22.11.2026: «В поликлинику» не помещалось): у каждой видимой кнопки
 *  ни одна строка текста не выходит за её края. Проверяется на каждом снимке. */
async function buttonsFit(p: Page, name: string): Promise<void> {
  const out = await p.evaluate(() => {
    const bad: string[] = [];
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('[role="button"]'))) {
      const r = b.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(b).visibility === 'hidden') continue;
      const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const t = range.getBoundingClientRect();
        if (t.left < r.left - 1 || t.right > r.right + 1) bad.push(`«${n.textContent.trim().slice(0, 40)}»: текст ${Math.round(t.width)} px, кнопка ${Math.round(r.width)} px`);
      }
    }
    return bad;
  });
  if (out.length) throw new Error(`${name}: текст не помещается в кнопку\n${out.join('\n')}`);
  checks++;
}
const snap = async (p: Page, name: string) => {
  // экран проявляется, части встают по очереди, числа итога досчитывают (src/ui/anim.tsx): снимок — когда всё встало
  await p.waitForTimeout(1100);
  await buttonsFit(p, name);
  return p.screenshot({ path: join(OUT, `${String(++shot).padStart(2, '0')}-${name}.png`) });
};
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
  const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: VS });
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  // часы смены — в 20 раз быстрее ×1: смена проходится за минуты (src/state/session.ts, setPace)
  // «Замер» — короткий (bench=quick): сцены по секунде, десять поисков
  // зерно 2: первый звонок потока учебной смены — из дома, и подъезд закрыт (срез, С4): «как пройти» сценарий не спрашивает
  await page.goto(`http://localhost:${server.port}/?pace=20&bench=quick&seed=2`);

  await see(page, 'title-name', 'Диспетчер 03');
  await see(page, 'title-not-training', 'Это игра. Если нужна помощь');
  await see(page, 'title-start', 'Первая неделя');
  await snap(page, 'title');

  // настройки: переключатели пишутся сразу
  await page.getByTestId('title-settings').click();
  await see(page, 'settings-sound', 'Звук');
  await page.getByTestId('settings-haptics').click();
  await page.getByTestId('settings-haptics').click();
  // «Мягкий исход» (срез, С3) — выключен по умолчанию, переключается и пишется сразу
  await see(page, 'settings-softOutcome', 'Мягкий исход');
  await see(page, 'settings-softOutcome', 'выкл.');
  await page.getByTestId('settings-softOutcome').click();
  await see(page, 'settings-softOutcome', 'вкл.');
  await page.getByTestId('settings-softOutcome').click();
  await see(page, 'settings-softOutcome', 'выкл.');
  await snap(page, 'settings');
  await page.getByTestId('settings-back').click();
  await see(page, 'title-start');

  // смена: загрузка с ходом полосы → вставка «начало смены» (касание пропускает) → пульт с вводом поверх карты; часы
  // стоят, пока ввод не закрыт
  await page.getByTestId('title-start').click();
  // выбор смены «Первой недели» (срез, часть С1): открыта только первая
  await see(page, 'week', 'Понедельник, утро');
  await see(page, 'week-2', 'Откроется после смены 1');
  // «Свободная смена» (срез, С8в) — закрыта, пока не пройдена неделя
  await see(page, 'week-free', 'Откроется, когда пройдена вся неделя');
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
  // «Без выезда» — с подтверждением: «Вернуться к разговору» оставляет вызов открытым (игра владельца 22.11.2026)
  await page.getByTestId('call-form-none').click();
  await page.getByText('Закрыть вызов без бригады?').waitFor({ state: 'visible', timeout: 5000 });
  await page.getByText('Вернуться к разговору', { exact: true }).click();
  await see(page, 'call-q-q.age');
  checks++;
  await page.getByTestId('call-form-emergency').click();
  await see(page, 'hint', 'ближайшей бригаде');
  await see(page, 'call-crews', 'Кого послать');
  // «Ещё спросить» — вопросы снова, форму можно назвать заново
  await page.getByTestId('call-more').click();
  await see(page, 'call-q-q.age');
  await page.getByTestId('call-form-emergency').click();
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
  let calls = 1, reports = 0, held = 0, picked = 0, shotReport = false, shotWaiting = false, dialed = 0, lastTile = 0, snags = 0, onsite = 0;
  for (let i = 0; i < 3000; i++) {
    if (await visible('end')) break;
    const snag = (await visible('snag-door')) ? 'door' : (await visible('snag-address')) ? 'address' : (await visible('snag-victim')) ? 'victim' : null;
    if (snag) {
      // просьба бригады не про медицину (срез, С4): «пусть ждут» — и касание рации: бригада у подъезда, вставка на месте.
      // Часы сценария ускорены в 20 раз: срок просьбы и подъезд пройдут за доли секунды — сперва пауза
      if ((await speed()) !== 'пауза') await tap('pult-clock');
      if (!snags && (await visible(`snag-${snag}`))) {
        const text = await page.getByTestId(`snag-${snag}`).first().innerText({ timeout: 1500 }).catch(() => '');
        if (!text.includes('Бригада')) throw new Error(`окно просьбы без бригады: ${text}`);
        await snap(page, `snag-${snag}`);
        checks++;
      }
      if (await tap('snag-wait')) snags++;
      if (!onsite && snag !== 'victim' && (await tap('pult-radio'))) {
        if (await page.getByTestId('insert').first().waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) {
          await page.waitForTimeout(1200);
          await snap(page, 'insert-onsite');
          await page.getByTestId('insert').first().click({ timeout: 1500 }).catch(() => {});
          onsite++;
          if (await page.getByTestId('crew-card').first().waitFor({ state: 'visible', timeout: 2500 }).then(() => true, () => false)) {
            await snap(page, 'crew-card-onsite');
            await tap('crew-card-close');
          }
        }
      }
    } else if (await visible('report')) {
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
      // первый раз — перезвонить ждущему (игра владельца 22.11.2026): разговор открывается снова
      if (!dialed && (await visible('crews-dial')) && (await tap('crews-dial'))) {
        if (await visible('call')) {
          const said = (await page.getByTestId('call-said').getAttribute('aria-label')) ?? '';
          if (!said.includes('Скорая беспокоит')) throw new Error(`перезвон: на экране «${said}»`);
          // перезвонили — сначала вопросы и формы, не окно бригад
          await see(page, 'call-form-emergency');
          if (await visible('call-crews')) throw new Error('перезвон: сразу окно бригад');
          await snap(page, 'call-dialed');
          dialed++;
        }
      } else if (!dialed) {
        // линия занята — «Перезвонить» нет: окно закрыть и попробовать снова, когда линия освободится (бригаду не слать —
        // ждущий нужен для перезвона)
        await tap('crews-close');
      } else if (await visible('crews-0')) { if (await tap('crews-0')) picked++; }
      else await tap('crews-close');
    } else if (await visible('pult')) {
      const now = await speed();
      if ((await line()) > 0) await tap('pult-phone');
      // перезвонить ждущему можно только на свободной линии: часы на паузу — новый звонок не придёт, пока окно открывается
      // (на медленной машине линия иначе всегда успевала заняться)
      else if (!dialed && (await visible('pult-waiting-0'))) {
        if (now !== 'пауза') await tap('pult-clock');
        await tap('pult-waiting-0');
      }
      else if (now === 'пауза') await tap('pult-clock');
      else if (now === '×1') await tap('pult-speed');
      else if (Date.now() - lastTile > 2000 && (await visible('pult-waiting-0'))) { lastTile = Date.now(); await tap('pult-waiting-0'); }
      else await page.waitForTimeout(150);
    } else await page.waitForTimeout(100);
  }
  await see(page, 'end-emergency', 'Экстренные с доездом до 20 минут');
  console.log(`смена: ${calls} звонков, ${reports} докладов с больницей, ${held} ждали, ${picked} посланы с пульта, ${dialed} перезвон, ${snags} просьб на месте, ${onsite} вставок на месте`);
  // зерно 2 — подъезд закрыт на первом звонке потока: просьба и вставка на месте должны быть
  if (!snags || !onsite) throw new Error('не было просьбы бригады на месте или вставки на месте');
  if (!dialed) throw new Error('ждущему не перезвонили: «Перезвонить» не было на свободной линии');
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
  // адрес вызова — улица и дом из OpenStreetMap (игра владельца 22.11.2026)
  await see(page, 'call-review-address');
  checks++;
  await see(page, 'call-review-known', 'По известному');
  await see(page, 'call-review-truth', 'По правде');
  await snap(page, 'call-review');
  await page.getByTestId('call-review-back').click();
  await see(page, 'review-main');
  // «К станции» (срез, С2): письмо старшего врача, журнал фонда, табель следующей смены, укладки; решение — с
  // подтверждением, решений в перерыве — три
  await page.getByTestId('end-home').click();
  await see(page, 'station-fund', 'решений осталось: 3 из 3');
  await page.waitForTimeout(800);
  await snap(page, 'station');
  await page.getByTestId('station-letter').click();
  await see(page, 'station-panel-letter', 'Письмо старшего врача после смены 1');
  await see(page, 'station-panel-letter', 'На счёт станции');
  await snap(page, 'station-letter');
  await page.getByTestId('station-close').click();
  await page.getByTestId('station-ledger').click();
  await see(page, 'station-panel-ledger', 'Смена 1: за смену и экстренные в норму');
  await page.getByTestId('station-close').click();
  await page.getByTestId('station-roster').click();
  await see(page, 'station-panel-roster', 'Табель на смену 2');
  await snap(page, 'station-roster');
  // из табеля — в «Закупки» (игра владельца 22.11.2026: «как попасть в меню закупки?»)
  await page.getByTestId('station-roster-shop').click();
  await see(page, 'station-panel-shop', 'Закупки станции');
  // после первой смены на новую бригаду фонда ещё нет: машина и два фельдшера — 320 тыс.
  await see(page, 'station-crew-base.north', 'не хватает фонда');
  await see(page, 'station-stock-base.north', 'Склад на подстанции');
  await page.getByTestId('station-close').click();
  // «Закупки» — и кнопкой внизу станции: укладки — отметить бригады и заказать одним решением
  await page.getByTestId('station-shop').click();
  await see(page, 'station-panel-shop', 'Пополнить укладки');
  const refill = (await page.getByTestId('station-kits').count()) > 0 && !(await page.getByTestId('station-kits').innerText()).includes('Отметьте');
  if (refill) {
    await see(page, 'station-kits', 'Заказать на');
    await page.getByTestId('station-kits').click();
    await page.getByRole('button', { name: 'Да', exact: true }).click();
    await see(page, 'station-fund', 'решений осталось: 2 из 3');
  }
  await snap(page, 'station-shop');
  await page.getByTestId('station-close').click();
  console.log(`станция: ${(await page.getByTestId('station-fund').innerText()).trim()}${refill ? ', укладки пополнены' : ''}`);
  // «К неделе»: первая смена пройдена — вторая открыта, у первой — лучший итог
  await page.getByTestId('station-week').click();
  await see(page, 'week-1', 'Лучший итог');
  await see(page, 'week-2', 'Понедельник, вечер');
  // неделя начата — с выбора смены есть путь на станцию
  await see(page, 'week-station', 'Станция');
  await snap(page, 'week-after');
  await page.getByTestId('week-station').click();
  await see(page, 'station-next', 'Смена 2');
  await page.getByTestId('station-week').click();
  await page.getByTestId('week-back').click();
  await see(page, 'title-name');
  // неделя начата — «Продолжить неделю» ведёт на станцию (срез, С8; §3, шаг 1)
  await see(page, 'title-week', 'Продолжить неделю');
  await page.getByTestId('title-week').click();
  await see(page, 'station-next', 'Смена 2');
  await page.getByTestId('station-week').click();
  await page.getByTestId('week-back').click();

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

  // «Сообщить об ошибке» (путь к 1.0, В1): отчёт виден целиком до отправки — версия, экран, слова игрока и журнал сбоев;
  // запись журнала кладём в хранилище сами (ошибка в консоли — провал сценария)
  await page.evaluate(([key]) => localStorage.setItem(key, JSON.stringify([{ at: Date.UTC(2026, 10, 21, 8, 0), kind: 'error', message: 'PultScreen\nError: проба сценария' }])), [KEYS.crashlog]);
  await page.getByTestId('about-report').click();
  await see(page, 'report-text', 'Версия: ');
  await see(page, 'report-text', 'Экран: about');
  await see(page, 'report-text', 'Error: проба сценария');
  await page.getByTestId('report-what').fill('Карта погасла после третьего вызова');
  await see(page, 'report-text', 'Что случилось Карта погасла после третьего вызова');
  await snap(page, 'report');
  await page.getByTestId('report-back').click();
  await see(page, 'about-version', 'Версия');
  await page.evaluate(([key]) => localStorage.removeItem(key), [KEYS.crashlog]);

  await page.getByTestId('about-back').click();
  await see(page, 'title-name');
  // из настроек — туда же и обратно в настройки
  await page.getByTestId('title-settings').click();
  await page.getByTestId('settings-report').click();
  await see(page, 'report-text', 'Экран: settings');
  await see(page, 'report-text', 'ошибок не записано');
  await page.getByTestId('report-back').click();
  await see(page, 'settings-sound', 'Звук');
  await page.getByTestId('settings-back').click();
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

  // итог недели (срез, С8; §3, шаги 9–10) — в конце: перезагрузка страницы стирает замеры загрузки смены в памяти,
  // которые читает «Замер»: шесть смен сыграны — станция зовёт на седьмую; семь — итог недели, снимок
  // недели, «Неделя заново»
  const put = async (rows: Record<string, string>) => {
    await page.evaluate(r => { for (const [k, v] of Object.entries(r)) localStorage.setItem(k, v); }, rows);
    await page.reload();
    await see(page, 'title-name');
  };
  await put(WEEK[5]);
  await see(page, 'title-week', 'Продолжить неделю');
  await page.getByTestId('title-week').click();
  await see(page, 'station-next', 'Смена 7');
  await put(WEEK[6]);
  if (await visible('title-week')) throw new Error('неделя пройдена, а на заглавном экране «Продолжить неделю»');
  await page.getByTestId('title-start').click();
  await see(page, 'week-end-open', 'Итог недели');
  await snap(page, 'week-done');
  await page.getByTestId('week-end-open').click();
  await see(page, 'week-end', 'Неделя пройдена');
  await see(page, 'week-end-7', 'Суббота, ночь');
  await see(page, 'week-end-total', 'За неделю');
  await see(page, 'week-end-station', 'Фонд в конце недели');
  await snap(page, 'week-end');
  const weekShot = page.waitForEvent('download', { timeout: 15000 });
  await page.getByTestId('week-end-snapshot').click();
  await (await weekShot).saveAs(join(OUT, `${String(++shot).padStart(2, '0')}-week-snapshot.png`));
  await see(page, 'week-end-snapshot-done', 'Снимок готов');
  // «Неделя заново»: с подтверждением; станция с нуля, лучшие итоги — на месте
  await page.getByTestId('week-end-again').click();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await see(page, 'week-1', 'Лучший итог');
  await see(page, 'week-7', 'Лучший итог');
  if (await visible('week-end-open')) throw new Error('после «Неделя заново» над сменами всё ещё «Итог недели»');
  await snap(page, 'week-again');
  // «Свободная смена» (срез, С8в): у всех смен недели есть итог — открыта; час на выбор — пульт с этого часа
  await page.getByTestId('week-free').scrollIntoViewIfNeeded();
  await see(page, 'free-hour', 'Начало: 19:00');
  await page.getByTestId('free-hour-more').click();
  await see(page, 'free-hour', 'Начало: 20:00');
  await page.getByTestId('free-general-less').click();
  await see(page, 'free-general', 'Общепрофильных бригад: 4');
  await snap(page, 'week-free');
  await page.getByTestId('free-go').click();
  await see(page, 'insert');
  await page.getByTestId('insert').click();
  await see(page, 'pult');
  if (await visible('intro-go')) await page.getByTestId('intro-go').click();
  // часы рисует Skia — время смены в подписи для чтения с экрана
  {
    const label = (await page.getByTestId('pult-clock').getAttribute('aria-label')) ?? '';
    if (!/Часы смены: 20:0/.test(label)) throw new Error(`свободная смена с 20:00, а часы: «${label}»`);
    checks++;
  }
  await snap(page, 'free-pult');
  await page.getByTestId('map-back').click();
  await see(page, 'title-name');

  // размер текста — три ступени (срез, С8б; критерий 8): снимок каждого экрана на каждой ступени — заглавный, выбор
  // смены, пульт (свободная смена продолжается), настройки; вернуть обычный
  for (const step of ['крупнее', 'крупный', 'обычный']) {
    await page.getByTestId('title-settings').click();
    await page.getByTestId('settings-textSize').click();
    await see(page, 'settings-textSize', step);
    if (step === 'обычный') { await page.getByTestId('settings-back').click(); break; }
    await snap(page, `text-${step}-settings`);
    await page.getByTestId('settings-back').click();
    await see(page, 'title-name');
    await snap(page, `text-${step}-title`);
    await page.getByTestId('title-start').click();
    await see(page, 'week-free');
    await snap(page, `text-${step}-week`);
    await page.getByTestId('week-back').click();
    await page.getByTestId('title-resume').click();
    await see(page, 'pult');
    if (await visible('intro-go')) await page.getByTestId('intro-go').click();
    await page.waitForTimeout(600);
    await snap(page, `text-${step}-pult`);
    await page.getByTestId('map-back').click();
    await see(page, 'title-name');
  }
  await see(page, 'title-name');

  // граница ошибок (путь к 1.0, В1): заглавный экран падает при рисовании (`?crash=1`, один раз) — вместо пустого
  // экрана «Что-то пошло не так», ошибка — в журнале сбоев и в отчёте. Своя страница: ошибка в её консоли — та самая
  {
    const crash = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: VS });
    const own: string[] = [];
    crash.on('console', m => { if (m.type() === 'error') own.push(m.text()); });
    crash.on('pageerror', e => own.push(String(e)));
    await crash.goto(`http://localhost:${server.port}/?crash=1`);
    await see(crash, 'crash-screen', 'Что-то пошло не так');
    await snap(crash, 'crash');
    await crash.getByTestId('crash-report').click();
    await see(crash, 'report-text', 'Экран: title');
    await see(crash, 'report-text', ' render] ');
    await see(crash, 'report-text', 'error boundary probe');
    await crash.getByTestId('report-back').click();
    await see(crash, 'title-name');
    await crash.close();
    const foreign = own.filter(e => !e.includes('error boundary probe') && !/The above error occurred|ErrorBoundary/.test(e));
    if (foreign.length) throw new Error(`ошибки в консоли страницы сбоя:\n${foreign.join('\n')}`);
  }

  // загрузка смены (премиум-отделка): какая смена начинается и шаги с настоящим ходом. В браузере шаги идут одним
  // куском — экран не успеть снять; `?loading=hold` держит его, пока не коснутся: все шаги сделаны, 100 %
  {
    const load = await browser.newPage({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
    load.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    load.on('pageerror', e => errors.push(String(e)));
    await load.goto(`http://localhost:${server.port}/?loading=hold`);
    await load.getByTestId('title-start').click();
    await load.getByTestId('week-1').click();
    await see(load, 'loading-shift', 'Понедельник, утро');
    await load.getByTestId('loading-percent').filter({ hasText: '100' }).waitFor({ state: 'visible', timeout: 15000 });
    checks++;
    await see(load, 'loading', 'Карта района');
    await snap(load, 'loading');
    await load.getByTestId('loading').click();
    await see(load, 'insert');
    await load.close();
  }

  if (errors.length) throw new Error(`ошибки в консоли:\n${errors.join('\n')}`);
  console.log(`сценарий пройден: ${checks} проверок, ${shot} снимков в ${OUT}`);
} finally {
  await browser.close();
  server.stop(true);
}
