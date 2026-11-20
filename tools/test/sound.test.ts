// Звуки смены (спецификация прототипа, §7): синтез своим кодом, файлы в assets/audio — байт в байт то, что даёт
// tools/sound/gen.ts; звонок короче полутора секунд, щелчок рации — пятой доли секунды; без перегруза.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileOf, PEAK, RATE, SOUND_IDS, synth, wav } from '../sound/gen';

describe('звуки', () => {
  for (const id of SOUND_IDS) {
    test(`${id}: файл — тот, что даёт синтез`, () => {
      const bytes = wav(synth(id), PEAK[id]);
      expect(Buffer.from(readFileSync(fileOf(id))).equals(Buffer.from(bytes))).toBe(true);
      const seconds = (bytes.length - 44) / 2 / RATE;
      expect(seconds).toBeLessThan(id === 'ring' ? 1.5 : 0.2);
      const v = new DataView(bytes.buffer);
      let max = 0;
      for (let i = 44; i < bytes.length; i += 2) max = Math.max(max, Math.abs(v.getInt16(i, true)));
      expect(max / 32767).toBeLessThanOrEqual(PEAK[id] + 0.001);
    });
  }
});
