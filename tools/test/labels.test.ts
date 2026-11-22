// Текст на кнопках (игра владельца 22.11.2026: «В поликлинику» не помещалось): подпись кнопки, нарисованной Skia, —
// длинный вариант, если помещается, иначе короткий, иначе уменьшенный (`fitLabel`, src/scenes/call/layout.ts); шире
// кнопки она не бывает. Кнопки React Native проверяет сценарий в браузере: на каждом снимке текст внутри кнопки.
import { describe, expect, test } from 'bun:test';
import { T } from '../../src/i18n';
import { MIN_SCALE, fitLabel } from '../../src/scenes/call/layout';
import { TEXT_SCALES } from '../../src/ui/textScale';

/** Мерка шрифта для проверки: ширина буквы — доля кегля (у Onest 600 кириллица — около 0,6 кегля). */
const measureAt = (size: number) => (s: string) => [...s].reduce((a, ch) => a + (ch === ' ' ? 0.3 : /[ЖШЩМЮФЫ]/i.test(ch) ? 0.8 : 0.6) * size, 0);

describe('подпись кнопки', () => {
  test('первый вариант, что помещается; не помещается ни один — короткий и уменьшенный; меньше предела — с многоточием', () => {
    const m = (s: string) => s.length * 10;
    expect(fitLabel(['Э  Экстренная', 'Экстренная'], 200, m)).toEqual({ text: 'Э  Экстренная', scale: 1 });
    expect(fitLabel(['Э  Экстренная', 'Экстренная'], 110, m)).toEqual({ text: 'Экстренная', scale: 1 });
    expect(fitLabel(['Э  Экстренная', 'Экстренная'], 80, m)).toEqual({ text: 'Экстренная', scale: 0.8 });
    const tiny = fitLabel(['Экстренная'], 35, m);
    expect(tiny.scale).toBe(MIN_SCALE);
    expect(tiny.text.endsWith('…')).toBe(true);
    expect(m(tiny.text) * tiny.scale).toBeLessThanOrEqual(35);
  });

  test('формы вызова и вкладки вопросов — на любом экране и ступени текста не шире кнопки', () => {
    for (const width of [320, 360, 412]) {
      for (const s of TEXT_SCALES) {
        // кнопка формы: экран монитора без полей, три в ряд (src/scenes/call/layout.ts)
        const fw = (width - 12 - 16 - 24 - 16) / 3 - 8;
        const m = measureAt(14 * s);
        for (const [letter, name] of T.call.forms) {
          const f = fitLabel([`${letter}  ${name}`, name], fw, m);
          expect(m(f.text) * f.scale, `${width}, ×${s}: ${name}`).toBeLessThanOrEqual(fw + 0.001);
        }
        for (const tab of Object.values(T.call.tabs)) {
          const f = fitLabel([tab], 40, measureAt(12 * s));
          expect(measureAt(12 * s)(f.text) * f.scale).toBeLessThanOrEqual(40.001);
        }
      }
    }
  });
});
