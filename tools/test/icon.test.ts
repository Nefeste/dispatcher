// Значок приложения и заставка (части П9 и 0.10.1; tools/art/icon.ts; устав, docs/05-rules.md: «Заставка при запуске —
// два фона»): файлы сходятся с паспортом, все — 1024 × 1024; знак на слоях — в безопасном круге значка Android
// (66 dp из 108 dp), на заставке — в круге 192 dp из поля 288 dp; app.json показывает на них; у заставки фон — лён
// (фон заглавного экрана), и у темы заставки фон окна тот же: плагин стоит перед expo-splash-screen.
import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { C } from '../../src/ui/theme';

const ROOT = join(import.meta.dir, '../..');
const passport = JSON.parse(readFileSync(join(ROOT, 'assets/icon.json'), 'utf8')) as {
  made: { size: number; safe: number; splashSafe: number; radius: Record<string, number> };
  files: Record<string, { sha256: string; bytes: number }>;
};
type Plugin = string | [string, Record<string, unknown>];
const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')) as {
  expo: { icon: string; backgroundColor: string; android: { adaptiveIcon: Record<string, string> }; plugins: Plugin[] };
};
const names = app.expo.plugins.map(p => (typeof p === 'string' ? p : p[0]));

/** Ширина и высота PNG — из заголовка IHDR. */
function pngSize(b: Buffer): [number, number] {
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

describe('значок', () => {
  test('файлы сходятся с паспортом, все 1024 × 1024', () => {
    expect(Object.keys(passport.files).sort()).toEqual([
      'assets/adaptive-background.png', 'assets/adaptive-foreground.png', 'assets/adaptive-monochrome.png', 'assets/icon.png', 'assets/splash-icon.png',
    ]);
    for (const [file, f] of Object.entries(passport.files)) {
      const b = readFileSync(join(ROOT, file));
      expect([file, createHash('sha256').update(b).digest('hex')]).toEqual([file, f.sha256]);
      expect(pngSize(b)).toEqual([passport.made.size, passport.made.size]);
    }
  });
  test('знак на слоях — в безопасном круге, на заставке — в круге Android 12', () => {
    expect(passport.made.safe).toBeCloseTo(66 / 108);
    expect(passport.made.splashSafe).toBeCloseTo(192 / 288);
    for (const layer of ['foreground', 'monochrome']) {
      expect(passport.made.radius[layer]).toBeGreaterThan(0.2);
      expect(passport.made.radius[layer]).toBeLessThanOrEqual(passport.made.safe / 2);
    }
    expect(passport.made.radius.splash).toBeGreaterThan(0.2);
    expect(passport.made.radius.splash).toBeLessThanOrEqual(passport.made.splashSafe / 2);
  });
  test('app.json показывает на значок и слои', () => {
    expect(app.expo.icon).toBe('./assets/icon.png');
    const a = app.expo.android.adaptiveIcon;
    expect(a.foregroundImage).toBe('./assets/adaptive-foreground.png');
    expect(a.backgroundImage).toBe('./assets/adaptive-background.png');
    expect(a.monochromeImage).toBe('./assets/adaptive-monochrome.png');
  });
});

describe('заставка', () => {
  test('плагин expo-splash-screen: фон — лён, как у заглавного экрана; картинка — знак, поле 288 dp', () => {
    const p = app.expo.plugins.find(x => Array.isArray(x) && x[0] === 'expo-splash-screen') as [string, Record<string, unknown>] | undefined;
    expect(p).toBeDefined();
    expect(String(p![1].backgroundColor).toLowerCase()).toBe(C.linen);
    expect(app.expo.backgroundColor.toLowerCase()).toBe(C.linen);
    expect(p![1].image).toBe('./assets/splash-icon.png');
    expect(p![1].imageWidth).toBe(288);
  });
  test('у темы заставки фон окна — тот же, без белой вспышки; плагин стоит перед expo-splash-screen', () => {
    type Style = { $: { name: string }; item?: { $: { name: string }; _: string }[] };
    const { transforms: t } = require('../../plugins/with-splash-window.js') as {
      transforms: { styles: (x: { resources: { style: Style[] } }) => { resources: { style: Style[] } }; THEME: string; ITEM: string; VALUE: string };
    };
    const xml = { resources: { style: [
      { $: { name: 'AppTheme' }, item: [{ $: { name: 'android:windowBackground' }, _: '@color/activityBackground' }] },
      { $: { name: t.THEME }, item: [{ $: { name: 'android:windowBackground' }, _: '@android:color/white' }] },
    ] } };
    const out = t.styles(xml).resources.style;
    expect(out.find(s => s.$.name === t.THEME)!.item!.filter(i => i.$.name === t.ITEM).map(i => i._)).toEqual(['@color/splashscreen_background']);
    expect(out.find(s => s.$.name === 'AppTheme')!.item![0]._).toBe('@color/activityBackground');
    // моды Expo идут в обратном порядке: плагин раньше в списке — его правка ложится после темы expo-splash-screen
    expect(names.indexOf('./plugins/with-splash-window.js')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('./plugins/with-splash-window.js')).toBeLessThan(names.indexOf('expo-splash-screen'));
  });
  test('заставка не висит: уходит на первом кадре заглавного экрана и не позже 4 с', () => {
    const src = readFileSync(join(ROOT, 'src/state/splash.ts'), 'utf8');
    expect(src).toContain('export const SPLASH_MAX_MS = 4000;');
    expect(src).toContain('setTimeout(hideSplash, SPLASH_MAX_MS)');
    const appSrc = readFileSync(join(ROOT, 'App.tsx'), 'utf8');
    expect(appSrc).toContain('keepSplash();');
    expect(appSrc).toContain('requestAnimationFrame(hideSplash)');
  });
});
