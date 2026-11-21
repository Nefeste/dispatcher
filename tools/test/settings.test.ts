// Настройки игрока (src/state/settings.ts): мусор в хранилище не ломает игру, «меньше движения» без выбора
// игрока — как в системе телефона (ADR устава 0023, правило 6).
import { describe, expect, test } from 'bun:test';
import { DEFAULT_SETTINGS, lessMotionOf, parseSettings } from '../../src/state/settings';

describe('настройки', () => {
  test('пусто и мусор — по умолчанию: автопауза, звук и отклик включены, «Мягкий исход» выключен', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('{не json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toEqual({ autopause: true, sound: true, haptics: true, softOutcome: false, textSize: 0 });
  });

  test('сохранённый выбор читается как был', () => {
    expect(parseSettings(JSON.stringify({ autopause: false, sound: false, haptics: false, lessMotion: true, softOutcome: true, textSize: 2 }))).toEqual({ autopause: false, sound: false, haptics: false, lessMotion: true, softOutcome: true, textSize: 2 });
    // размер текста (срез, С8б): нет или не ступень — обычный; сохранённые до 0.23.0 настройки читаются
    expect(parseSettings(JSON.stringify({ textSize: 5 })).textSize).toBe(0);
    expect(parseSettings(JSON.stringify({ textSize: 1 })).textSize).toBe(1);
    // сохранено до «Мягкого исхода» (0.13.0) — выключен
    expect(parseSettings(JSON.stringify({ autopause: true, sound: true, haptics: true })).softOutcome).toBe(false);
  });

  test('«меньше движения»: выбор игрока важнее системы, без выбора — система', () => {
    expect(lessMotionOf({ ...DEFAULT_SETTINGS }, true)).toBe(true);
    expect(lessMotionOf({ ...DEFAULT_SETTINGS }, false)).toBe(false);
    expect(lessMotionOf({ ...DEFAULT_SETTINGS, lessMotion: false }, true)).toBe(false);
  });
});
