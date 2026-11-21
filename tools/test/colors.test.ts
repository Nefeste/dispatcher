// Цвета форм вызова различимы при трёх видах нарушения цветового зрения (спецификация среза, критерий 8; §12
// геймдизайна): на пульте и в разговоре — красный, янтарный и серый; на карте — кольца вызовов. Цвет никогда не
// единственный знак: у каждой формы ещё и буква.
// Модель зрения — из bolnitsa: tools/test/departments-ui.test.ts @ b5c9e3a (матрицы Machado, Oliveira, Fernandes, 2009,
// полная степень, в линейном RGB; разница — CIE76 в Lab, D65).
import { describe, expect, test } from 'bun:test';
import { T } from '../../src/i18n';
import { FORM, UI } from '../../src/scenes/palette';
import { FORM_MARK, MAP, UNDECIDED } from '../../src/ui/map/palette';

const CVD: Record<string, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
};
const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
function labOf(hex: string, m: number[][]): number[] {
  const v = parseInt(hex.slice(1), 16);
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map(x => lin(x / 255));
  const [r, g, b] = m.map(row => Math.min(1, Math.max(0, row[0] * c[0] + row[1] * c[1] + row[2] * c[2])));
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
/** Цвет поверх фона с прозрачностью — как его видит глаз. */
function over(hex: string, back: string, alpha: number): string {
  const p = (h: string) => { const v = parseInt(h.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const a = p(hex), b = p(back);
  return `#${a.map((x, i) => Math.round(x * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, '0')).join('')}`;
}
/** Наименьшая разница между цветами набора при каждом виде зрения. */
function minDelta(colors: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [kind, m] of Object.entries(CVD)) {
    let min = Infinity;
    for (let i = 0; i < colors.length; i++)
      for (let j = i + 1; j < colors.length; j++) {
        const a = labOf(colors[i], m), b = labOf(colors[j], m);
        min = Math.min(min, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    out[kind] = Math.round(min);
  }
  return out;
}

describe('цвета форм вызова', () => {
  test('пульт и разговор: «экстренная», «неотложная», «без выезда» и фон программы различимы (ΔE ≥ 15)', () => {
    // «без выезда» — серый на 35 % поверх фона экрана (src/scenes/call/CallScene.tsx)
    const d = minDelta([FORM.emergency, FORM.urgent, over(UI.dim, UI.bg, 0.35), UI.bg]);
    for (const [kind, v] of Object.entries(d)) expect([kind, v >= 15]).toEqual([kind, true]);
  });

  test('карта: кольца экстренного, неотложного и нерешённого вызова и суша различимы (ΔE ≥ 15)', () => {
    const d = minDelta([FORM_MARK.emergency, FORM_MARK.urgent, UNDECIDED, MAP.land]);
    for (const [kind, v] of Object.entries(d)) expect([kind, v >= 15]).toEqual([kind, true]);
  });

  test('цвет не единственный знак: у каждой формы своя буква', () => {
    const letters = T.call.forms.map(([l]) => l);
    expect(new Set(letters).size).toBe(letters.length);
    expect(T.pult.forms.emergency[0] as string).toBe(letters[0]);
    expect(T.pult.forms.urgent[0] as string).toBe(letters[1]);
  });
});
