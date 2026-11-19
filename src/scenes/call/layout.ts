// Раскладка сцены «Разговор» (ADR 0009) — чистая функция: картинка звонящего сверху, строка его ответа, монитор с
// опросником под ней. Вопросы и решение — в нижней половине, под большим пальцем (docs/08-game-design.md, §12).
import type { Rect } from '../pult/layout';

export interface CallLayout {
  picture: Rect;
  bubble: Rect;
  monitor: Rect;
  screen: Rect;
  fields: Rect;
  fieldStep: number;
  tabs: { x: number; y: number; step: number[] };
  questions: Rect[];
  forms: Rect[];
}

/** Картинка звонящего — 1080 × 960 (blender/caller.py); на длинном экране обрезается по бокам («cover»). */
const PICTURE_ASPECT = 960 / 1080;

export function callLayout(width: number, height: number, fields = 6): CallLayout {
  const ph = Math.max(Math.min(width * PICTURE_ASPECT, height * 0.4), height * 0.44);
  const picture = { x: 0, y: 0, w: width, h: ph };
  const bubble = { x: 12, y: ph - 58, w: width - 24, h: 40 };
  const monitor = { x: 6, y: ph - 6, w: width - 12, h: height - ph };
  const screen = { x: monitor.x + 8, y: monitor.y + 8, w: monitor.w - 16, h: monitor.h - 16 };
  const fieldStep = 24;
  const fieldsBox = { x: screen.x, y: screen.y + 34, w: screen.w, h: fields * fieldStep + 8 };
  const gap = 8;
  const formH = 46;
  const qH = 46;
  const forms: Rect[] = [];
  const fw = (screen.w - 24 - gap * 2) / 3;
  const formY = screen.y + screen.h - formH - 12;
  for (let i = 0; i < 3; i++) forms.push({ x: screen.x + 12 + i * (fw + gap), y: formY, w: fw, h: formH });
  const questions: Rect[] = [];
  const qw = (screen.w - 24 - gap) / 2;
  const qTop = formY - gap * 2 - qH * 2 - gap;
  for (let i = 0; i < 4; i++) {
    questions.push({ x: screen.x + 12 + (i % 2) * (qw + gap), y: qTop + Math.floor(i / 2) * (qH + gap), w: qw, h: qH });
  }
  const tabs = { x: screen.x + 12, y: qTop - 36, step: [64, 160, 128] };
  return { picture, bubble, monitor, screen, fields: fieldsBox, fieldStep, tabs, questions, forms };
}
