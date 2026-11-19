// Картинки экранов рабочего места (docs/13-art.md, «Рабочее место»): Skia рисует их во внеэкранную поверхность,
// Three.js кладёт пиксели на экраны мониторов и видеостены (scene.ts). Тексты — из src/i18n, шрифт — Onest студии.
// Перерисовываются, когда меняется смена, а не каждый кадр. Что на каком экране — по источникам листа стиля: слева
// карточка вызова, справа карта с бригадами, на стене — карта и табло загрузки.
import { AlphaType, ColorType, PaintStyle, type SkCanvas, type SkFont, type SkTypeface, Skia, StrokeCap, StrokeJoin } from '@shopify/react-native-skia';
import { T } from '../../i18n';
import type { MapData } from '../../map/format';
import { mapPaths } from '../../ui/map/paths';
import { MAP } from '../../ui/map/palette';
import { UI } from '../palette';

export interface Pixels { rgba: Uint8Array; w: number; h: number }


const STATE: Record<string, string> = { free: UI.green, drive: UI.amber, scene: UI.red, transport: UI.blue, back: UI.dim };

/** Доли на табло загрузки видеостены — пример для эталонного кадра, не числа игры. */
const BOARD = [0.22, 0.61, 0.74] as const;

function paint(color: string, stroke?: number) {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(color));
  if (stroke !== undefined) {
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(stroke);
    p.setStrokeCap(StrokeCap.Round);
    p.setStrokeJoin(StrokeJoin.Round);
  }
  return p;
}

function surface(w: number, h: number, draw: (c: SkCanvas) => void): Pixels {
  const s = Skia.Surface.MakeOffscreen(w, h);
  if (!s) throw new Error('offscreen surface unavailable');
  const c = s.getCanvas();
  draw(c);
  s.flush();
  const img = s.makeImageSnapshot();
  const px = img.readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  if (!px) throw new Error('readPixels failed');
  return { rgba: px instanceof Uint8Array ? px : new Uint8Array(px.buffer), w, h };
}

function text(c: SkCanvas, s: string, x: number, y: number, font: SkFont, color: string) {
  c.drawText(s, x, y, paint(color), font);
}

/** Карта района в прямоугольнике (x, y, w, h): слои игры, бригады и вызов — точки. `dark` — ночная карта стены. */
function drawMap(c: SkCanvas, m: MapData, x: number, y: number, w: number, h: number, dark: boolean) {
  const paths = mapPaths(m);
  // вырезка: Канавино и центр у Стрелки — середина района
  const k = Math.max(w / (m.width * 0.62), h / (m.height * 0.42));
  c.save();
  c.clipRect(Skia.XYWHRect(x, y, w, h), 1, true);
  c.drawRect(Skia.XYWHRect(x, y, w, h), paint(dark ? '#10161b' : MAP.land));
  c.translate(x - m.width * 0.12 * k, y - m.height * 0.2 * k);
  c.scale(k, k);
  c.drawPath(paths.green, paint(dark ? '#1c2a24' : MAP.green));
  c.drawPath(paths.water, paint(dark ? '#16303d' : MAP.water));
  const road = (i: number, px: number, color: string) => c.drawPath(paths.roads[i], paint(color, px / k));
  road(3, 1.1, dark ? '#2b3740' : MAP.road[3]);
  for (const i of [2, 1, 0]) road(i, 3.2 - i * 0.1 + 1.6, dark ? '#202a31' : MAP.casing);
  for (const i of [2, 1, 0]) road(i, 3.2 - i * 0.1, dark ? '#5b6a73' : MAP.road[i]);
  c.restore();
  // бригады и вызов — места для эталонного кадра (точки в долях прямоугольника)
  const dots: [number, number, string][] = [[0.28, 0.42, UI.green], [0.55, 0.62, UI.amber], [0.7, 0.35, UI.red], [0.4, 0.75, UI.blue], [0.82, 0.68, UI.amber]];
  for (const [fx, fy, col] of dots) {
    c.drawCircle(x + fx * w, y + fy * h, h * 0.022, paint('#ffffff'));
    c.drawCircle(x + fx * w, y + fy * h, h * 0.016, paint(col));
  }
  const cx = x + 0.62 * w, cy = y + 0.48 * h;
  c.drawCircle(cx, cy, h * 0.05, paint(UI.red, h * 0.008));
  c.drawCircle(cx, cy, h * 0.012, paint(UI.red));
}

/** Карточка вызова: шапка с номером пульта, счётчик времени на линии, поля, форма и бригада. */
export function callScreen(face: SkTypeface, w: number, h: number): Pixels {
  const big = Skia.Font(face, h * 0.062), mid = Skia.Font(face, h * 0.052), small = Skia.Font(face, h * 0.042);
  return surface(w, h, c => {
    c.clear(Skia.Color(UI.bg));
    c.drawRect(Skia.XYWHRect(0, 0, w, h * 0.13), paint(UI.panel));
    text(c, T.desk.call.head, w * 0.04, h * 0.085, big, UI.text);
    const tw = mid.getTextWidth(T.desk.call.timer);
    text(c, T.desk.call.timer, w * 0.96 - tw, h * 0.085, mid, UI.amber);
    T.desk.call.rows.forEach(([k, v], i) => {
      const y = h * (0.24 + i * 0.11);
      text(c, k, w * 0.04, y, small, UI.dim);
      text(c, v, w * 0.3, y, mid, UI.text);
      c.drawLine(w * 0.04, y + h * 0.035, w * 0.96, y + h * 0.035, paint(UI.line, 1));
    });
    const y = h * 0.86;
    c.drawRRect(Skia.RRectXY(Skia.XYWHRect(w * 0.04, y - h * 0.07, w * 0.3, h * 0.1), 8, 8), paint(UI.red));
    text(c, T.desk.call.form, w * 0.065, y, mid, '#16090c');
    text(c, T.desk.call.crew, w * 0.38, y, mid, UI.amber);
  });
}

/** Карта с бригадами: карта слева, справа — бригады с состоянием и цветом. */
export function mapScreen(m: MapData, face: SkTypeface, w: number, h: number): Pixels {
  const head = Skia.Font(face, h * 0.06), row = Skia.Font(face, h * 0.045), tiny = Skia.Font(face, h * 0.036);
  const mw = Math.round(w * 0.62);
  return surface(w, h, c => {
    c.clear(Skia.Color(UI.bg));
    drawMap(c, m, 0, 0, mw, h, false);
    const x = mw + w * 0.025, right = w * 0.975;
    text(c, T.desk.crews.head, x, h * 0.09, head, UI.text);
    T.desk.crews.rows.forEach(([n, kind, state, key], i) => {
      const y = h * (0.2 + i * 0.133);
      c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x - w * 0.01, y - h * 0.06, right - x + w * 0.01, h * 0.115), 6, 6), paint(UI.panel));
      c.drawCircle(x + h * 0.025, y - h * 0.015, h * 0.022, paint(STATE[key] ?? UI.dim));
      text(c, n, x + h * 0.07, y - h * 0.002, row, UI.text);
      text(c, kind, x + h * 0.15, y - h * 0.002, tiny, UI.dim);
      text(c, state, x + h * 0.07, y + h * 0.042, tiny, STATE[key] ?? UI.text);
    });
  });
}

/** Видеостена: ночная карта, рядом табло загрузки, шапка и строка обстановки. */
export function wallScreen(m: MapData, face: SkTypeface, w: number, h: number): Pixels {
  const big = Skia.Font(face, h * 0.06), mid = Skia.Font(face, h * 0.04);
  const mw = Math.round(w * 0.72);
  return surface(w, h, c => {
    c.clear(Skia.Color('#0d1216'));
    drawMap(c, m, 0, 0, mw, h, true);
    c.drawRect(Skia.XYWHRect(0, 0, w, h * 0.1), paint('#0d1216'));
    text(c, T.desk.wall.head, w * 0.02, h * 0.07, big, UI.text);
    // табло: доля и полоса на каждую строку
    const x = mw + w * 0.025, bw = w - x - w * 0.025;
    text(c, T.desk.wall.board, x, h * 0.2, big, UI.text);
    T.desk.wall.bars.forEach((label, i) => {
      const y = h * (0.33 + i * 0.19);
      const share = BOARD[i] ?? 0;
      text(c, label, x, y, mid, UI.dim);
      const pct = `${Math.round(share * 100)} %`;
      text(c, pct, x + bw - mid.getTextWidth(pct), y, mid, UI.text);
      c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y + h * 0.03, bw, h * 0.05), 4, 4), paint(UI.line));
      c.drawRRect(Skia.RRectXY(Skia.XYWHRect(x, y + h * 0.03, bw * share, h * 0.05), 4, 4), paint([UI.green, UI.amber, UI.blue][i] ?? UI.dim));
    });
    c.drawRect(Skia.XYWHRect(0, h * 0.92, w, h * 0.08), paint('#0d1216'));
    text(c, T.desk.wall.line, w * 0.02, h * 0.975, mid, UI.amber);
  });
}

/** Экран соседа: программа без слов — полосы и строки, чтобы зал жил. */
export function genericScreen(w: number, h: number, seed: number): Pixels {
  return surface(w, h, c => {
    c.clear(Skia.Color(UI.bg));
    c.drawRect(Skia.XYWHRect(0, 0, w, h * 0.12), paint(UI.panel));
    for (let i = 0; i < 7; i++) {
      const len = 0.35 + (((seed * 7 + i * 13) % 10) / 10) * 0.55;
      c.drawRRect(Skia.RRectXY(Skia.XYWHRect(w * 0.06, h * (0.2 + i * 0.11), w * len, h * 0.05), 4, 4),
        paint(i % 3 === seed % 3 ? UI.amber : UI.line));
    }
  });
}
