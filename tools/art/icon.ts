// Значок приложения (часть П9; docs/13-art.md, «Значок»): нарисован своим кодом — «03» шрифтом Kurale цветом льна на
// кумаче, цвета и шрифт — брендбука студии (src/ui/theme.ts). Без креста и без машины: эмблему «Красный Крест» не
// рисуем (спецификация прототипа, §12), номер 03 знают все. Слои значка Android 8+ — передний, фон цветом и
// одноцветный для тем Android 13; «03» целиком — в безопасном круге 66 dp из 108 dp. Рисует Chromium без окна
// (Playwright), паспорт с отпечатками — assets/icon.json (tools/test/icon.test.ts сверяет).
//
//   NODE_PATH=/opt/node22/lib/node_modules bun tools/art/icon.ts
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { C } from '../../src/ui/theme';

const ROOT = join(import.meta.dir, '../..');
const FONT = join(ROOT, 'node_modules/@expo-google-fonts/kurale/400Regular/Kurale_400Regular.ttf');
/** Размер файла, точек: 1024 — как просит Expo для значка и слоёв. */
export const SIZE = 1024;
/** Безопасный круг значка Android: 66 dp из 108 dp — его диаметр в долях стороны слоя. */
export const SAFE = 66 / 108;

type Layer = 'icon' | 'foreground' | 'monochrome';

/** Разметка слоя: холст, на нём «03» — середина самих букв (по `measureText`) в середине слоя; у значка целиком —
 *  квадрат кумача со скруглением, у слоёв — прозрачный фон. Возвращает и рамку букв для проверки круга. */
function page(layer: Layer, font: string): string {
  const size = layer === 'icon' ? SIZE * 0.5 : SIZE * 0.4;
  const color = layer === 'monochrome' ? '#ffffff' : C.linen;
  return `<!doctype html><html><head><style>
@font-face { font-family: Kurale; src: url(data:font/ttf;base64,${font}); }
html, body { margin: 0; background: transparent; }
canvas { display: block; }
</style></head><body><canvas id="c" width="${SIZE}" height="${SIZE}"></canvas><script>
window.draw = async () => {
  await document.fonts.load('${size}px Kurale');
  const c = document.getElementById('c').getContext('2d');
  ${layer === 'icon' ? `c.fillStyle = '${C.kumach}'; c.beginPath(); c.roundRect(0, 0, ${SIZE}, ${SIZE}, ${SIZE * 0.18}); c.fill();` : ''}
  c.font = '${size}px Kurale';
  c.textAlign = 'left';
  c.textBaseline = 'alphabetic';
  const m = c.measureText('03');
  const w = m.actualBoundingBoxLeft + m.actualBoundingBoxRight;
  const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
  const x = ${SIZE / 2} - w / 2 + m.actualBoundingBoxLeft;
  const y = ${SIZE / 2} - h / 2 + m.actualBoundingBoxAscent;
  c.fillStyle = '${color}';
  c.fillText('03', x, y);
  return { w, h };
};
</script></body></html>`;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

if (import.meta.main) {
  const font = readFileSync(FONT).toString('base64');
  const browser = await chromium.launch();
  const files: Record<string, { sha256: string; bytes: number }> = {};
  const box: Record<string, number> = {};
  try {
    const p = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
    for (const layer of ['icon', 'foreground', 'monochrome'] as const) {
      await p.setContent(page(layer, font));
      // «03» — внутри безопасного круга: рамка самих букв, середина — в середине слоя
      const r = await p.evaluate(() => (window as unknown as { draw: () => Promise<{ w: number; h: number }> }).draw());
      const half = Math.hypot(r.w, r.h) / 2 / SIZE;
      box[layer] = Number(half.toFixed(3));
      if (layer !== 'icon' && half > SAFE / 2) throw new Error(`«03» на слое ${layer} выходит из безопасного круга: ${half} > ${SAFE / 2}`);
      const png = await p.locator('#c').screenshot({ omitBackground: true });
      const file = `assets/${layer === 'icon' ? 'icon' : `adaptive-${layer}`}.png`;
      writeFileSync(join(ROOT, file), png);
      files[file] = { sha256: sha(png), bytes: png.length };
    }
  } finally {
    await browser.close();
  }
  const passport = {
    id: 'icon',
    name: 'Значок приложения: «03» шрифтом Kurale на кумаче',
    licence: 'своя работа студии «Горница»; шрифт — Kurale (SIL OFL 1.1, assets/fonts/Kurale-OFL.txt)',
    made: { script: 'tools/art/icon.ts', renderer: `Chromium ${browser.version()} (Playwright)`, size: SIZE, background: C.kumach, color: C.linen, safe: SAFE, halfDiagonal: box },
    files,
  };
  writeFileSync(join(ROOT, 'assets/icon.json'), `${JSON.stringify(passport, null, 2)}\n`);
  console.log('значок:', Object.keys(files).join(', '));
}
