// Снимок смены (спецификация прототипа, §5): карта района с путями всех бригад за смену и тремя числами итога —
// картинкой для себя. Рисуется на внеэкранной поверхности Skia (как в «Сказах»: skazy src/ui/sign.tsx @ 9385727), без
// живого холста; PNG сохраняет src/ui/saveImage.ts. Слова — от вызывающего (src/i18n).
import { ClipOp, FillType, PaintStyle, type SkFont, Skia, StrokeCap, StrokeJoin } from '@shopify/react-native-skia';
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
  const top = 140;
  const box = { x: 40, y: top, w: W - 80, h: H - top - 360 };
  const k = Math.min(box.w / m.width, box.h / m.height);
  const ox = box.x + (box.w - m.width * k) / 2;
  const oy = box.y + (box.h - m.height * k) / 2;
  canvas.save();
  canvas.clipRect(Skia.XYWHRect(box.x, box.y, box.w, box.h), ClipOp.Intersect, true);
  canvas.drawRect(Skia.XYWHRect(box.x, box.y, box.w, box.h), fill(MAP.land));
  canvas.translate(ox, oy);
  canvas.scale(k, k);
  const paths = mapPaths(m);
  canvas.drawPath(paths.green, fill(MAP.green));
  canvas.drawPath(paths.water, fill(MAP.water));
  for (let c = paths.roads.length - 1; c >= 0; c--) canvas.drawPath(paths.roads[c], stroke(MAP.casing, (c < 2 ? 3 : 1.6) / k));
  // следы бригад: каждая — своим цветом, по рёбрам в порядке проезда
  s.crews.forEach((crew, i) => {
    const b = Skia.PathBuilder.Make();
    for (const t of s.trail) {
      if (t.crew !== crew.id || t.nodes.length < 2) continue;
      b.moveTo(m.nodes.x[t.nodes[0]], m.nodes.y[t.nodes[0]]);
      for (let j = 0; j < t.edges.length; j++) {
        const e = t.edges[j];
        const forward = m.edges.a[e] === t.nodes[j];
        const s0 = m.edges.shape.starts[e], s1 = m.edges.shape.starts[e + 1];
        for (let q = 1; q < s1 - s0; q++) {
          const p = forward ? s0 + q : s1 - 1 - q;
          b.lineTo(m.edges.shape.pts[p * 2], m.edges.shape.pts[p * 2 + 1]);
        }
      }
    }
    const path = b.detach();
    path.setFillType(FillType.Winding);
    canvas.drawPath(path, stroke(TRAIL[i % TRAIL.length], 7 / k));
  });
  // подстанции и больницы
  for (const p of ctx.city.bases) canvas.drawCircle(m.nodes.x[p.node], m.nodes.y[p.node], 14 / k, fill(MARK.base));
  for (const p of ctx.city.hospitals) canvas.drawRect(Skia.XYWHRect(m.nodes.x[p.node] - 12 / k, m.nodes.y[p.node] - 12 / k, 24 / k, 24 / k), fill(MARK.hospital));
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
