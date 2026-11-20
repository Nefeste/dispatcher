// Значок приложения (часть П9; tools/art/icon.ts): файлы сходятся с паспортом, все — 1024 × 1024, «03» на слоях —
// в безопасном круге значка Android (66 dp из 108 dp), app.json показывает на них. Рисует их скрипт, руками не правят.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dir, '../..');
const passport = JSON.parse(readFileSync(join(ROOT, 'assets/icon.json'), 'utf8')) as {
  made: { size: number; safe: number; halfDiagonal: Record<string, number> };
  files: Record<string, { sha256: string; bytes: number }>;
};

/** Ширина и высота PNG — из заголовка IHDR. */
function pngSize(b: Buffer): [number, number] {
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('значок', () => {
  test('файлы сходятся с паспортом, все 1024 × 1024', () => {
    expect(Object.keys(passport.files).sort()).toEqual(['assets/adaptive-foreground.png', 'assets/adaptive-monochrome.png', 'assets/icon.png']);
    for (const [file, f] of Object.entries(passport.files)) {
      const b = readFileSync(join(ROOT, file));
      expect([file, createHash('sha256').update(b).digest('hex')]).toEqual([file, f.sha256]);
      expect(pngSize(b)).toEqual([passport.made.size, passport.made.size]);
    }
  });
  test('«03» на слоях — в безопасном круге', () => {
    expect(passport.made.safe).toBeCloseTo(66 / 108);
    for (const layer of ['foreground', 'monochrome']) expect(passport.made.halfDiagonal[layer]).toBeLessThanOrEqual(passport.made.safe / 2);
  });
  test('app.json показывает на значок и слои', () => {
    const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as { expo: { icon: string; android: { adaptiveIcon: Record<string, string> } } };
    expect(app.expo.icon).toBe('./assets/icon.png');
    expect(app.expo.android.adaptiveIcon.foregroundImage).toBe('./assets/adaptive-foreground.png');
    expect(app.expo.android.adaptiveIcon.monochromeImage).toBe('./assets/adaptive-monochrome.png');
    expect(app.expo.android.adaptiveIcon.backgroundColor.toLowerCase()).toBe('#b3162f');
  });
});
