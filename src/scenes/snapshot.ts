// Снимок смены (спецификация прототипа, §5): карта района с путями всех бригад за смену и тремя числами итога —
// картинкой для себя. Рисуется на внеэкранной поверхности Skia (как в «Сказах»: skazy src/ui/sign.tsx @ 9385727), без
// живого холста; PNG сохраняет src/ui/saveImage.ts. Слова — от вызывающего (src/i18n).
import { ClipOp, FillType, PaintStyle, type SkCanvas, type SkFont, type SkPaint, type SkPathBuilder, Skia, StrokeCap, StrokeJoin } from '@shopify/react-native-skia';
import type { City } from '../content/types';
import type { MapData } from '../map/format';
import type { Shift, ShiftCtx } from '../engine/shift';
import { mapPaths } from '../ui/map/paths';
import { MAP, MARK } from '../ui/map/palette';
import { C } from '../ui/theme';

/** Цвета следов бригад: различимы между собой и на светлой карте. */
const TRAIL = ['#b3162f', '#2a5d8f', '#2f7d5b', '#8a5d00', '#6b3d8c', '#1f6f78', '#a04a00', '#4b4f4c'];

export const SNAP = { w: 1080, h: 1350 } as const;

export interface SnapWords {
  title: string;
  /** подпись цветов путей: «Пути бригад:», дальше — номера бригад их цветом */
  crews: string;
  lines: string[];
  osm: string;
}

/** PNG снимка; null — поверхность не создалась. */
export function shiftSnapshot(ctx: ShiftCtx, s: Shift, words: SnapWords, fonts: { title: SkFont; body: SkFont; small: SkFont }): Uint8Array | null {
  const { w: W, h: H } = SNAP;
  const surface = Skia.Surface.Make(W, H);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const fill = (color: string) => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColor(Skia.Color(color));
    return p;
  };
  const stroke = (color: string, width: number) => {
    const p = fill(color);
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(width);
    p.setStrokeCap(StrokeCap.Round);
    p.setStrokeJoin(StrokeJoin.Round);
    return p;
  };
  canvas.drawRect(Skia.XYWHRect(0, 0, W, H), fill(C.linen));
  canvas.drawText(words.title, 60, 100, fill(C.ink), fonts.title);

  // карта — во всю ширину под заголовком, с сохранением пропорций
  const m = ctx.map;
  const box = { x: 40, y: 140, w: W - 80, h: H - 140 - 360 };
  const k = mapUnder(canvas, m, box, fill, stroke);
  // следы бригад: каждая — своим цветом, по рёбрам в порядке проезда
  s.crews.forEach((crew, i) => {
    const b = Skia.PathBuilder.Make();
    for (const t of s.trail) {
      if (t.crew !== crew.id || t.nodes.length < 2) continue;
      b.moveTo(m.nodes.x[t.nodes[0]], m.nodes.y[t.nodes[0]]);
      for (let j = 0; j < t.edges.length; j++) edgeTo(b, m, t.edges[j], m.edges.a[t.edges[j]] === t.nodes[j]);
    }
    const path = b.detach();
    path.setFillType(FillType.Winding);
    canvas.drawPath(path, stroke(TRAIL[i % TRAIL.length], 7 / k));
  });
  places(canvas, m, ctx.city, k, fill);
  canvas.restore();

  // подпись цветов: номер бригады — кружком её цвета
  const ly = box.y + box.h + 56;
  canvas.drawText(words.crews, 60, ly, fill(C.inkSoft), fonts.small);
  // ширина строки — по ширинам глифов: measureText в веб-сборке Skia не реализован
  const textW = (t: string) => fonts.small.getGlyphWidths(fonts.small.getGlyphIDs(t)).reduce((a, b) => a + b, 0);
  let lx = 60 + textW(words.crews) + 28;
  s.crews.forEach((crew, i) => {
    const no = crew.id.split('.')[1] ?? String(i + 1);
    canvas.drawCircle(lx, ly - 9, 20, fill(TRAIL[i % TRAIL.length]));
    const tw = textW(no);
    canvas.drawText(no, lx - tw / 2, ly, fill('#ffffff'), fonts.small);
    lx += 56;
  });

  // три числа итога и строка OpenStreetMap (ADR 0004)
  words.lines.forEach((line, i) => canvas.drawText(line, 60, H - 220 + i * 56, fill(C.ink), fonts.body));
  canvas.drawText(words.osm, 60, H - 40, fill(C.inkSoft), fonts.small);
  surface.flush();
  const image = surface.makeImageSnapshot();
  const bytes = image.encodeToBytes();
  image.dispose();
  surface.dispose();
  return bytes;
}

type Fill = (color: string) => SkPaint;
type Stroke = (color: string, width: number) => SkPaint;

/** Ребро `e` в путь — от текущей точки к его другому концу по его форме. */
function edgeTo(b: SkPathBuilder, m: MapData, e: number, forward: boolean): void {
  const s0 = m.edges.shape.starts[e], s1 = m.edges.shape.starts[e + 1];
  for (let q = 1; q < s1 - s0; q++) {
    const p = forward ? s0 + q : s1 - 1 - q;
    b.lineTo(m.edges.shape.pts[p * 2], m.edges.shape.pts[p * 2 + 1]);
  }
}

/** Подложка карты в рамке `box`: зелень, вода, дороги. Холст после неё — в координатах карты, с обрезкой по рамке
 *  (`restore` — у вызывающего); возвращает масштаб. */
function mapUnder(canvas: SkCanvas, m: MapData, box: { x: number; y: number; w: number; h: number }, fill: Fill, stroke: Stroke): number {
  const k = Math.min(box.w / m.width, box.h / m.height);
  canvas.save();
  canvas.clipRect(Skia.XYWHRect(box.x, box.y, box.w, box.h), ClipOp.Intersect, true);
  canvas.drawRect(Skia.XYWHRect(box.x, box.y, box.w, box.h), fill(MAP.land));
  canvas.translate(box.x + (box.w - m.width * k) / 2, box.y + (box.h - m.height * k) / 2);
  canvas.scale(k, k);
  const paths = mapPaths(m);
  canvas.drawPath(paths.green, fill(MAP.green));
  canvas.drawPath(paths.water, fill(MAP.water));
  for (let c = paths.roads.length - 1; c >= 0; c--) canvas.drawPath(paths.roads[c], stroke(MAP.casing, (c < 2 ? 3 : 1.6) / k));
  return k;
}

/** Подстанции кружками, больницы квадратами. */
function places(canvas: SkCanvas, m: MapData, city: Pick<City, 'bases' | 'hospitals'>, k: number, fill: Fill): void {
  for (const p of city.bases) canvas.drawCircle(m.nodes.x[p.node], m.nodes.y[p.node], 14 / k, fill(MARK.base));
  for (const p of city.hospitals) canvas.drawRect(Skia.XYWHRect(m.nodes.x[p.node] - 12 / k, m.nodes.y[p.node] - 12 / k, 24 / k, 24 / k), fill(MARK.hospital));
}

/** Снимок недели — выше снимка смены: под картой семь строк итога. */
export const WEEK_SNAP = { w: 1080, h: 1700 } as const;

export interface WeekSnapWords {
  title: string;
  /** подпись цветов путей: «Смены:», дальше — номера смен их цветом */
  shifts: string;
  /** строка на смену по порядку и строка станции */
  lines: string[];
  osm: string;
}

/** Снимок недели (спецификация среза, §5): карта района с путями бригад всех смен этой станции — каждая смена своим
 *  цветом, — и строки итога. Пути — рёбра из журнала недели (src/state/weekLog.ts). PNG; null — поверхность не
 *  создалась. */
export function weekSnapshot(m: MapData, city: Pick<City, 'bases' | 'hospitals'>, shifts: { n: number; edges: number[] }[], words: WeekSnapWords, fonts: { title: SkFont; body: SkFont; small: SkFont }): Uint8Array | null {
  const { w: W, h: H } = WEEK_SNAP;
  const surface = Skia.Surface.Make(W, H);
  if (!surface) return null;
  const canvas = surface.getCanvas();
  const fill: Fill = color => {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColor(Skia.Color(color));
    return p;
  };
  const stroke: Stroke = (color, width) => {
    const p = fill(color);
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(width);
    p.setStrokeCap(StrokeCap.Round);
    p.setStrokeJoin(StrokeJoin.Round);
    return p;
  };
  canvas.drawRect(Skia.XYWHRect(0, 0, W, H), fill(C.linen));
  canvas.drawText(words.title, 60, 100, fill(C.ink), fonts.title);
  const box = { x: 40, y: 140, w: W - 80, h: H - 140 - 640 };
  const k = mapUnder(canvas, m, box, fill, stroke);
  // смены — по порядку: поздние ложатся поверх ранних; ребро — отдельным отрезком, без порядка проезда
  for (const sh of shifts) {
    const b = Skia.PathBuilder.Make();
    for (const e of sh.edges) {
      const a = m.edges.a[e];
      b.moveTo(m.nodes.x[a], m.nodes.y[a]);
      edgeTo(b, m, e, true);
    }
    // чуть прозрачнее: где смены ехали по одной улице, видны обе
    const p = stroke(TRAIL[(sh.n - 1) % TRAIL.length], 6 / k);
    p.setAlphaf(0.8);
    canvas.drawPath(b.detach(), p);
  }
  places(canvas, m, city, k, fill);
  canvas.restore();

  const textW = (t: string) => fonts.small.getGlyphWidths(fonts.small.getGlyphIDs(t)).reduce((a, b) => a + b, 0);
  const ly = box.y + box.h + 56;
  canvas.drawText(words.shifts, 60, ly, fill(C.inkSoft), fonts.small);
  let lx = 60 + textW(words.shifts) + 28;
  for (const sh of shifts) {
    canvas.drawCircle(lx, ly - 9, 20, fill(TRAIL[(sh.n - 1) % TRAIL.length]));
    const no = String(sh.n);
    canvas.drawText(no, lx - textW(no) / 2, ly, fill('#ffffff'), fonts.small);
    lx += 56;
  }
  words.lines.forEach((line, i) => canvas.drawText(line, 60, ly + 76 + i * 52, fill(i < words.lines.length - 1 ? C.ink : C.inkSoft), fonts.body));
  canvas.drawText(words.osm, 60, H - 40, fill(C.inkSoft), fonts.small);
  surface.flush();
  const image = surface.makeImageSnapshot();
  const bytes = image.encodeToBytes();
  image.dispose();
  surface.dispose();
  return bytes;
}
