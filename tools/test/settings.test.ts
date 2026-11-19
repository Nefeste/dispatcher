// Настройки игрока (src/state/settings.ts): мусор в хранилище не ломает игру, «меньше движения» без выбора
// игрока — как в системе телефона (ADR устава 0023, правило 6).
import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, lessMotionOf, parseSettings } from '../../src/state/settings';

describe('настройки', () => {
  test('пусто и мусор — по умолчанию: автопауза и звук включены', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{не json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ autopause: true, sound: true });
  });

  test('сохранённый выбор читается как был', () => {
    expect(parseSettings(JSON.stringify({ autopause: false, sound: false, lessMotion: true }))).toEqual({ autopause: false, sound: false, lessMotion: true });
  });

  test('«меньше движения»: выбор игрока важнее системы, без выбора — система', () => {
    expect(lessMotionOf({ ...DEFAULT_SETTINGS }, true)).toBe(true);
    expect(lessMotionOf({ ...DEFAULT_SETTINGS }, false)).toBe(false);
    expect(lessMotionOf({ ...DEFAULT_SETTINGS, lessMotion: false }, true)).toBe(false);
  });
});
