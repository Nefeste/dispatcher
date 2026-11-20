// Значок приложения и картинка заставки (части П9 и 0.10.1; docs/13-art.md, «Значок и заставка»): нарисованы своим
// кодом, как значок «Нард» (nardy: src/render/appIcon.ts @ 3ab05ab — устройство: слои адаптивной иконки в единицах
// 108 dp, градиенты, свет и тень SVG). Рисунок — то, что игрок видит на пульте: ночная карта района (слияние двух рек,
// улицы), янтарный путь бригады и вызов — метка кумачом с «03» шрифтом Kurale и круги вызова на карте. Креста и машины
// нет: эмблему «Красный Крест» не рисуем (спецификация прототипа, §12). Цвета — бренда (src/ui/theme.ts) и ночной
// карты.
//
// Слои Android 8+: фон (карта и путь), передний (метка с тенью) — целиком в безопасном круге 66 dp — и одноцветный
// для тем Android 13. Значок целиком — видимая середина 72 dp. Заставка Android 12+ — тот же значок в круге 192 dp из
// поля 288 dp на льне. Рисует Chromium без окна (Playwright); паспорт с отпечатками — assets/icon.json
// (tools/test/icon.test.ts сверяет).
//
//   NODE_PATH=/opt/node22/lib/node_modules bun tools/art/icon.ts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright';
import { C } from '../../src/ui/theme';

const ROOT = join(import.meta.dir, '../..');
const FONT = join(ROOT, 'node_modules/@expo-google-fonts/kurale/400Regular/Kurale_400Regular.ttf');
/** Размер файла, точек. */
export const SIZE = 1024;
/** Адаптивная иконка Android — 108 dp, видна середина 72 dp, всё важное — в круге 66 dp. */
export const ADAPTIVE = { size: 108, visible: 72, safe: 66 } as const;
export const SAFE = ADAPTIVE.safe / ADAPTIVE.size;
/** Заставка Android 12+: картинка в круге 192 dp из поля `SPLASH_DP`. */
export const SPLASH_DP = 288;
export const SPLASH_SAFE = 192 / SPLASH_DP;

export type Layer = 'icon' | 'background' | 'foreground' | 'monochrome' | 'splash';
export const LAYERS: readonly Layer[] = ['icon', 'background', 'foreground', 'monochrome', 'splash'];
export const FILES: Record<Layer, string> = {
  icon: 'assets/icon.png',
  background: 'assets/adaptive-background.png',
  foreground: 'assets/adaptive-foreground.png',
  monochrome: 'assets/adaptive-monochrome.png',
  splash: 'assets/splash-icon.png',
};

/** Цвета рисунка: ночь карты, реки, улицы, путь бригады, кумач метки. */
const PAL = {
  night: ['#2a3d55', '#16263a', '#0b1522'],
  river: ['#2f6378', '#1f4a5c'],
  riverEdge: '#4f8ea3',
  street: '#3a516a',
  avenue: '#5b7690',
  route: '#f0b445',
  routeGlow: '#ffcf6a',
  kumach: ['#e0344f', C.kumach, '#7d0d20'],
  rim: '#ff8a9a',
  linen: C.linen,
} as const;

/** Где стоит вызов: остриё метки и середина кругов на карте. */
const TIP = { x: 54, y: 76 } as const;
/** Голова метки: середина и радиус. */
const HEAD = { x: 54, y: 45, r: 19 } as const;

function defs(id: string): string {
  return `<defs>
    <radialGradient id="${id}-night" cx="42%" cy="38%" r="78%">
      <stop offset="0" stop-color="${PAL.night[0]}"/><stop offset="0.55" stop-color="${PAL.night[1]}"/><stop offset="1" stop-color="${PAL.night[2]}"/>
    </radialGradient>
    <linearGradient id="${id}-river" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${PAL.river[0]}"/><stop offset="1" stop-color="${PAL.river[1]}"/>
    </linearGradient>
    <radialGradient id="${id}-warm" cx="18%" cy="10%" r="65%">
      <stop offset="0" stop-color="#ffd9a0" stop-opacity="0.22"/><stop offset="1" stop-color="#ffd9a0" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${id}-vignette" cx="50%" cy="50%" r="72%">
      <stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/>
    </radialGradient>
    <radialGradient id="${id}-pulse" cx="50%" cy="50%" r="50%">
      <stop offset="0" stop-color="${PAL.kumach[0]}" stop-opacity="0.55"/><stop offset="1" stop-color="${PAL.kumach[0]}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-pin" x1="0.2" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="${PAL.kumach[0]}"/><stop offset="0.55" stop-color="${PAL.kumach[1]}"/><stop offset="1" stop-color="${PAL.kumach[2]}"/>
    </linearGradient>
    <radialGradient id="${id}-disc" cx="40%" cy="32%" r="75%">
      <stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="${PAL.linen}"/><stop offset="1" stop-color="#d5d7cd"/>
    </radialGradient>
    <linearGradient id="${id}-gloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.5"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <filter id="${id}-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
    <filter id="${id}-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.4"/></filter>
    <filter id="${id}-soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="0.35"/></filter>
  </defs>`;
}

/** Бригада — внизу слева в видимой части значка; её путь по улицам к вызову. */
const CREW = { x: 24, y: 63 } as const;
const ROUTE = `M ${CREW.x} ${CREW.y} L 36 61 L 39 69 L 47 73 L ${TIP.x} ${TIP.y}`;

/** Фон: ночная карта, реки, улицы, свет, путь бригады и круги вызова у острия метки. */
function back(id: string): string {
  const streets = [
    'M -5 20 L 40 30 L 70 18 L 115 26', 'M -5 58 L 30 54 L 62 62 L 115 56', 'M 20 -5 L 26 40 L 18 112',
    'M 88 -5 L 80 36 L 92 112', 'M -5 80 L 46 70 L 112 86', 'M 50 -5 L 56 22 L 46 40',
    'M 66 70 L 74 112', 'M 8 36 L 34 44', 'M 72 40 L 108 44',
  ].map(d => `<path d="${d}" fill="none" stroke="${PAL.street}" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  const avenues = ['M -5 70 L 38 62 L 70 74 L 115 64', 'M 38 -5 L 44 30 L 34 62 L 40 112']
    .map(d => `<path d="${d}" fill="none" stroke="${PAL.avenue}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
  // слияние рек: широкая с запада на восток и приток с юго-востока
  const rivers = `<path d="M -6 30 C 24 40, 40 22, 64 30 S 98 40, 114 14 L 114 4 C 96 26, 82 22, 64 20 S 26 28, -6 18 Z" fill="url(#${id}-river)"/>
    <path d="M 64 25 C 76 30, 92 28, 114 40 L 114 48 C 94 38, 76 38, 62 31 Z" fill="url(#${id}-river)"/>
    <path d="M -6 30 C 24 40, 40 22, 64 30 S 98 40, 114 14" fill="none" stroke="${PAL.riverEdge}" stroke-opacity="0.5" stroke-width="0.6"/>`;
  return `<rect width="108" height="108" fill="url(#${id}-night)"/>
    ${rivers}
    <g filter="url(#${id}-soft)">${streets}${avenues}</g>
    <rect width="108" height="108" fill="url(#${id}-warm)"/>
    <path d="${ROUTE}" fill="none" stroke="${PAL.routeGlow}" stroke-opacity="0.55" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" filter="url(#${id}-glow)"/>
    <path d="${ROUTE}" fill="none" stroke="${PAL.route}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${CREW.x}" cy="${CREW.y}" r="5.2" fill="${PAL.routeGlow}" opacity="0.45" filter="url(#${id}-glow)"/>
    <circle cx="${CREW.x}" cy="${CREW.y}" r="3.6" fill="${PAL.route}" stroke="#fff6e0" stroke-width="1.1"/>
    <ellipse cx="${TIP.x}" cy="${TIP.y}" rx="22" ry="8.5" fill="url(#${id}-pulse)"/>
    <ellipse cx="${TIP.x}" cy="${TIP.y}" rx="17" ry="6.2" fill="none" stroke="${PAL.kumach[0]}" stroke-opacity="0.55" stroke-width="1"/>
    <ellipse cx="${TIP.x}" cy="${TIP.y}" rx="10" ry="3.6" fill="none" stroke="${PAL.kumach[0]}" stroke-opacity="0.85" stroke-width="1.1"/>
    <rect width="108" height="108" fill="url(#${id}-vignette)"/>`;
}

/** Метка: капля с головой `HEAD` и остриём `TIP`. */
function pinPath(): string {
  const { x, y, r } = HEAD;
  // касательные из острия к окружности головы
  const a = Math.asin(r / (TIP.y - y));
  const tx = r * Math.cos(a), ty = r * Math.sin(a);
  return `M ${TIP.x} ${TIP.y} L ${x - tx} ${y + ty} A ${r} ${r} 0 1 1 ${x + tx} ${y + ty} Z`;
}

/** «03» по середине белого круга метки. */
function digits(fill: string): string {
  return `<text x="${HEAD.x}" y="${HEAD.y + 0.4}" text-anchor="middle" dominant-baseline="central" font-family="Kurale" font-size="15.5" fill="${fill}" stroke="${fill}" stroke-width="0.5" stroke-linejoin="round">03</text>`;
}

/** Передний слой: метка с тенью, бликом и «03»; `flat` — одноцветный силуэт с прорезанными цифрами. */
function front(id: string, flat = false): string {
  const pin = pinPath();
  if (flat) {
    return `<mask id="${id}-m"><rect width="108" height="108" fill="#000"/><path d="${pin}" fill="#fff"/>
      <circle cx="${HEAD.x}" cy="${HEAD.y}" r="13" fill="#000"/>${digits('#fff')}</mask>
      <rect width="108" height="108" fill="#fff" mask="url(#${id}-m)"/>`;
  }
  return `<g>
    <ellipse cx="${TIP.x + 1.5}" cy="${TIP.y + 0.6}" rx="7" ry="2.2" fill="#000" opacity="0.55" filter="url(#${id}-blur)"/>
    <g transform="translate(1.2 2.4)" filter="url(#${id}-blur)" opacity="0.5"><path d="${pin}" fill="#05080d"/></g>
    <path d="${pin}" fill="url(#${id}-pin)"/>
    <path d="${pin}" fill="none" stroke="${PAL.rim}" stroke-opacity="0.55" stroke-width="0.6"/>
    <ellipse cx="${HEAD.x - 5}" cy="${HEAD.y - 10}" rx="10" ry="5.5" fill="url(#${id}-gloss)" transform="rotate(-22 ${HEAD.x - 5} ${HEAD.y - 10})"/>
    <circle cx="${HEAD.x}" cy="${HEAD.y + 0.6}" r="13" fill="#5a0816" opacity="0.35"/>
    <circle cx="${HEAD.x}" cy="${HEAD.y}" r="13" fill="url(#${id}-disc)"/>
    ${digits(PAL.kumach[1])}
  </g>`;
}

/** Страница слоя: SVG в единицах 108 dp на холст `SIZE`; шрифт Kurale — из файла. */
function page(layer: Layer, font: string): string {
  const m = (ADAPTIVE.size - ADAPTIVE.visible) / 2;
  let body: string;
  let viewBox = '0 0 108 108';
  if (layer === 'background') body = defs('b') + back('b');
  else if (layer === 'foreground') body = defs('f') + front('f');
  else if (layer === 'monochrome') body = defs('m') + front('m', true);
  else if (layer === 'icon') {
    // значок целиком — видимая середина 72 dp, квадрат со скруглением, как у лаунчеров без масок
    viewBox = `${m} ${m} ${ADAPTIVE.visible} ${ADAPTIVE.visible}`;
    body = `${defs('i')}<clipPath id="i-c"><rect x="${m}" y="${m}" width="${ADAPTIVE.visible}" height="${ADAPTIVE.visible}" rx="${ADAPTIVE.visible * 0.22}"/></clipPath><g clip-path="url(#i-c)">${back('i')}${front('i')}</g>`;
  } else {
    // заставка: видимая середина 72 dp кругом, вписанным в круг 192 dp из поля 288 dp
    const k = ADAPTIVE.visible / (SPLASH_SAFE * 0.98);
    const off = 54 - k / 2;
    viewBox = `${off} ${off} ${k} ${k}`;
    body = `${defs('s')}<clipPath id="s-c"><circle cx="54" cy="54" r="${ADAPTIVE.visible / 2}"/></clipPath><g clip-path="url(#s-c)">${back('s')}${front('s')}</g>`;
  }
  return `<!doctype html><html><head><style>
@font-face { font-family: Kurale; src: url(data:font/ttf;base64,${font}); }
html, body { margin: 0; background: transparent; }
svg { display: block; }
</style></head><body><svg id="c" xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="${viewBox}">${body}</svg></body></html>`;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** Радиус нарисованного от середины, в долях стороны: по непрозрачным точкам снимка. */
async function inkRadius(p: Page, png: Buffer): Promise<number> {
  return p.evaluate(async b64 => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const cv = document.createElement('canvas');
    cv.width = img.width;
    cv.height = img.height;
    const c = cv.getContext('2d')!;
    c.drawImage(img, 0, 0);
    const px = c.getImageData(0, 0, cv.width, cv.height).data;
    let r2 = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      if (px[(y * cv.width + x) * 4 + 3] < 8) continue;
      const d = (x + 0.5 - cv.width / 2) ** 2 + (y + 0.5 - cv.height / 2) ** 2;
      if (d > r2) r2 = d;
    }
    return Math.sqrt(r2) / cv.width;
  }, png.toString('base64'));
}

if (import.meta.main) {
  const font = readFileSync(FONT).toString('base64');
  const browser = await chromium.launch();
  const files: Record<string, { sha256: string; bytes: number }> = {};
  const radius: Partial<Record<Layer, number>> = {};
  try {
    for (const layer of LAYERS) {
      // своя страница на слой: шрифт и рисунок без следов прежнего слоя
      const p = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
      await p.setContent(page(layer, font));
      await p.evaluate(() => document.fonts.ready);
      const png = await p.locator('#c').screenshot({ omitBackground: layer !== 'background' });
      if (layer === 'foreground' || layer === 'monochrome' || layer === 'splash') {
        const r = await inkRadius(p, png);
        radius[layer] = Number(r.toFixed(3));
        const limit = layer === 'splash' ? SPLASH_SAFE / 2 : SAFE / 2;
        if (r > limit) throw new Error(`слой ${layer} выходит из безопасного круга: ${r} > ${limit}`);
      }
      writeFileSync(join(ROOT, FILES[layer]), png);
      files[FILES[layer]] = { sha256: sha(png), bytes: png.length };
      await p.close();
    }
  } finally {
    await browser.close();
  }
  const passport = {
    id: 'icon',
    name: 'Значок приложения и картинка заставки: вызов «03» на ночной карте района, путь бригады',
    licence: 'своя работа студии «Горница»; шрифт — Kurale (SIL OFL 1.1, assets/fonts/Kurale-OFL.txt)',
    made: { script: 'tools/art/icon.ts', renderer: `Chromium ${browser.version()} (Playwright)`, size: SIZE, safe: SAFE, splashSafe: SPLASH_SAFE, radius },
    files,
  };
  writeFileSync(join(ROOT, 'assets/icon.json'), `${JSON.stringify(passport, null, 2)}\n`);
  console.log('значок и заставка:', Object.keys(files).join(', '), radius);
}
