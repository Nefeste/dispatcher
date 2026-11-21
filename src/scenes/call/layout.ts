// Раскладка сцены «Разговор» (ADR 0009) — чистая функция: картинка звонящего сверху, строка его ответа поверх неё,
// монитор с опросником под ней: шапка вызова, карточка, вкладки групп вопросов, вопросы группы, решение. Вопросы и
// решение — в нижней половине, под большим пальцем (docs/08-game-design.md, §12); касания — не меньше 44 точек.
import type { Rect } from '../pult/layout';

export interface CallLayout {
  picture: Rect;
  monitor: Rect;
  screen: Rect;
  /** карточка вызова: строки от шапки до вкладок */
  fields: Rect;
  fieldStep: number;
  /** сколько строк карточки помещается */
  rows: number;
  /** полоса вкладок групп вопросов */
  tabs: Rect;
  /** восемь мест под вопросы группы: два столбца, четыре ряда */
  questions: Rect[];
  /** где список бригад после решения — на месте вкладок и вопросов */
  choice: Rect;
  forms: Rect[];
}

/** Картинка звонящего — 1080 × 960 (blender/caller.py); на длинном экране обрезается по бокам («cover»). */
const PICTURE_ASPECT = 960 / 1080;
const GAP = 6;
const TAP_MIN = 44;
const HEAD_MIN = 34;

/** `s` — множитель размера текста (src/ui/textScale.ts): касания, шапка и шаг строк карточки растут вместе со шрифтом. */
export function callLayout(width: number, height: number, s = 1): CallLayout {
  const TAP = Math.round(TAP_MIN * s);
  const HEAD = Math.round(HEAD_MIN * s);
  // низ экрана монитора от картинки не зависит: решение, вопросы и вкладки считаются от него снизу вверх
  const bottom = height - 14;
  const formY = bottom - TAP - 10;
  const fieldStep = Math.round(22 * s);
  const tabsY = formY - GAP * 2 - (TAP * 4 + GAP * 3) - GAP - TAP;
  // картинка звонящего — сколько осталось над карточкой; с крупным текстом в карточке должны остаться хотя бы повод и
  // ответ — тогда картинка ниже, но не меньше пятой части экрана
  const ph = Math.max(height * 0.2, Math.min(Math.max(height * 0.31, Math.min(width * PICTURE_ASPECT, height * 0.33)), tabsY - GAP - HEAD - 2 - 2 * fieldStep));
  const picture = { x: 0, y: 0, w: width, h: ph };
  const monitor = { x: 6, y: ph - 6, w: width - 12, h: height - ph };
  const screen = { x: monitor.x + 8, y: monitor.y + 8, w: monitor.w - 16, h: monitor.h - 16 };
  const inner = { x: screen.x + 12, w: screen.w - 24 };
  const forms: Rect[] = [];
  const fw = (inner.w - GAP * 2) / 3;
  for (let i = 0; i < 3; i++) forms.push({ x: inner.x + i * (fw + GAP), y: formY, w: fw, h: TAP });
  const qw = (inner.w - GAP) / 2;
  const gridTop = formY - GAP * 2 - (TAP * 4 + GAP * 3);
  const questions: Rect[] = [];
  for (let i = 0; i < 8; i++) questions.push({ x: inner.x + (i % 2) * (qw + GAP), y: gridTop + Math.floor(i / 2) * (TAP + GAP), w: qw, h: TAP });
  const tabs = { x: inner.x, y: gridTop - GAP - TAP, w: inner.w, h: TAP };
  const fields = { x: screen.x, y: screen.y + HEAD, w: screen.w, h: Math.max(fieldStep, tabs.y - GAP - screen.y - HEAD) };
  const rows = Math.max(1, Math.floor(fields.h / fieldStep));
  const choice = { x: screen.x, y: tabs.y, w: screen.w, h: formY - GAP - tabs.y };
  return { picture, monitor, screen, fields, fieldStep, rows, tabs, questions, choice, forms };
}

/** Где рисовать картинку звонящего 1080 × 960, чтобы она закрыла окно `box` целиком: по ширине — посередине, по высоте
 *  — от верха кадра. Лишнее срезается снизу, а не поровну сверху и снизу («cover»): голова у кадров — в верхней трети,
 *  и на низком окне (маленький экран, крупный текст) её не срезает. */
export function pictureRect(box: Rect): Rect {
  const k = Math.max(box.w / 1080, box.h / 960);
  const w = 1080 * k, h = 960 * k;
  return { x: box.x + (box.w - w) / 2, y: box.y, w, h };
}

/** Строки текста не шире `max` по мерке `measure` — переносом по словам; длинное слово режется. */
export function wrap(text: string, max: number, measure: (s: string) => number, limit = 3): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (measure(next) <= max || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  if (out.length <= limit) return out;
  const cut = out.slice(0, limit);
  cut[limit - 1] = fit(`${cut[limit - 1]} ${out.slice(limit).join(' ')}`, max, measure);
  return cut;
}

/** Строка не шире `max`: лишнее — многоточием. */
export function fit(text: string, max: number, measure: (s: string) => number): string {
  if (measure(text) <= max) return text;
  let s = text;
  while (s.length > 1 && measure(`${s}…`) > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}
