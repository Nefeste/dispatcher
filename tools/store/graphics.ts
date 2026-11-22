// Графика карточки RuStore и страницы на сайте (store/README.md): значок 512 × 512 без прозрачности — из значка
// приложения (tools/art/icon.ts), баннер 1024 × 500 и картинка для ссылок 1200 × 630 — кадр рабочего места из Blender (assets/scenes/pult-desk.png)
// и название шрифтами студии. Рисует Chromium из Playwright: те же байты на любой машине с теми же шрифтами.
//
//   NODE_PATH=/opt/node22/lib/node_modules bun tools/store/graphics.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = join(import.meta.dir, '..', '..');
const OUT = join(ROOT, 'store', 'graphics');
const b64 = (p: string) => readFileSync(join(ROOT, p)).toString('base64');
const font = (p: string) => `url(data:font/ttf;base64,${b64(p)})`;

const css = `
@font-face { font-family: Kurale; src: ${font('node_modules/@expo-google-fonts/kurale/400Regular/Kurale_400Regular.ttf')}; }
@font-face { font-family: Onest; src: ${font('node_modules/@expo-google-fonts/onest/400Regular/Onest_400Regular.ttf')}; }
@font-face { font-family: OnestSB; src: ${font('node_modules/@expo-google-fonts/onest/600SemiBold/Onest_600SemiBold.ttf')}; }
* { margin: 0; box-sizing: border-box; }
body { width: var(--w); height: var(--h); overflow: hidden; background: #14181b; position: relative; }
.desk { position: absolute; right: 0; top: 0; width: calc(var(--w) - 384px); height: var(--h); background: url(data:image/png;base64,${b64('assets/scenes/pult-desk.png')}) center / cover; }
.fade { position: absolute; left: 384px; top: 0; width: 240px; height: var(--h); background: linear-gradient(90deg, #14181b, rgba(20,24,27,0)); }
.text { position: absolute; left: 56px; top: 0; height: var(--h); width: 420px; display: flex; flex-direction: column; justify-content: center; gap: 18px; }
h1 { font: 72px/1.02 Kurale; color: #f7f7f2; }
p { font: 26px/1.35 Onest; color: #cfd1c6; }
.tag { align-self: flex-start; font: 18px/1 OnestSB; color: #fff; background: #b3162f; padding: 10px 14px; border-radius: 6px; }
`;
const html = (w: number, h: number) => `<!doctype html><meta charset="utf-8"><style>:root{--w:${w}px;--h:${h}px}${css}</style>
<div class="desk"></div><div class="fade"></div>
<div class="text"><h1>Диспетчер 03</h1><p>Смена диспетчера скорой помощи в большом городе</p><span class="tag">Скоро в RuStore</span></div>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  // баннер карточки и картинка для ссылок (og, страница сайта) — один рисунок в двух размерах
  for (const [w, h, name] of [[1024, 500, 'feature-1024x500.png'], [1200, 630, 'og-1200x630.png']] as const) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.setContent(html(w, h));
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(OUT, name) });
  }
  // значок: значок приложения на его же фоне, без прозрачности (RuStore и сайт требуют квадрат без альфы)
  const icon = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await icon.setContent(`<!doctype html><style>*{margin:0}body{width:512px;height:512px;background:#ecede6}img{width:512px;height:512px;display:block}</style><img src="data:image/png;base64,${b64('assets/icon.png')}">`);
  await icon.waitForLoadState('load');
  await icon.screenshot({ path: join(OUT, 'icon-512.png'), omitBackground: false });
} finally {
  await browser.close();
}
console.log('store/graphics: icon-512.png, feature-1024x500.png, og-1200x630.png');
