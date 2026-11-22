// Звуки смены (спецификация прототипа, §7): синтез своим кодом, файлы в assets/audio — байт в байт то, что даёт
// tools/sound/gen.ts; у каждого своя наибольшая длина (звонок короче полутора секунд, щелчок рации — пятой доли секунды); без перегруза;
// фон зала — петля без шва.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileOf, MAX_SECONDS, PEAK, RATE, SOUND_IDS, synth, wav } from '../sound/gen';

describe('звуки', () => {
  for (const id of SOUND_IDS) {
    test(`${id}: файл — тот, что даёт синтез`, () => {
      const bytes = wav(synth(id), PEAK[id]);
      expect(Buffer.from(readFileSync(fileOf(id))).equals(Buffer.from(bytes))).toBe(true);
      const seconds = (bytes.length - 44) / 2 / RATE;
      expect(seconds).toBeLessThan(MAX_SECONDS[id]);
      const v = new DataView(bytes.buffer);
      let max = 0;
      for (let i = 44; i < bytes.length; i += 2) max = Math.max(max, Math.abs(v.getInt16(i, true)));
      expect(max / 32767).toBeLessThanOrEqual(PEAK[id] + 0.001);
    });
  }
  test('фон зала — петля: конец сходится с началом без щелчка', () => {
    const x = synth('hall');
    let max = 0;
    for (const v of x) max = Math.max(max, Math.abs(v));
    // шаг через шов — не больше обычного шага между соседними отсчётами
    let step = 0;
    for (let i = 1; i < x.length; i++) step = Math.max(step, Math.abs(x[i] - x[i - 1]));
    expect(Math.abs(x[0] - x[x.length - 1])).toBeLessThanOrEqual(step);
    expect(max).toBeGreaterThan(0);
  });
  test('звуки названы в проигрывателе игры все', () => {
    const src = readFileSync(join(import.meta.dir, '../../src/audio/feedback.ts'), 'utf8');
    for (const id of SOUND_IDS) expect(src).toContain(`assets/audio/${id}.wav`);
  });
});
