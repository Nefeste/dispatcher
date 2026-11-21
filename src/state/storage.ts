// Хранилище на телефоне (AsyncStorage, docs/04-data-model.md §3). Не прочиталось — игра идёт без него;
// не записалось — значение живёт, пока приложение открыто. По образцу shelter: src/state/storage.ts @ 396daee.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_SETTINGS, type Settings, parseSettings } from './settings';

/** Ключи хранилища — с версией: изменился смысл — новый ключ и шаг миграции (docs/04-data-model.md). */
export const KEYS = {
  settings: 'dispatcher.settings.v1',
  current: 'dispatcher.shift.current.v1',
  history: 'dispatcher.shift.history.v1',
  progress: 'dispatcher.progress.v1',
  /** станция недели: фонд, свои бригады, укладки, журнал фонда, письмо (срез, часть С2) */
  station: 'dispatcher.station.v1',
  /** журнал недели: итоги и пути бригад каждой смены, принятой станцией, — для итога и снимка недели (срез, часть С8) */
  week: 'dispatcher.week.v1',
} as const;

export async function readRaw(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function writeRaw(key: string, raw: string | null): Promise<void> {
  try {
    if (raw === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, raw);
  } catch {
    // нет места или нет хранилища — значение живёт, пока приложение открыто
  }
}

export async function loadSettings(): Promise<Settings> {
  const raw = await readRaw(KEYS.settings);
  return raw === null ? { ...DEFAULT_SETTINGS } : parseSettings(raw);
}

export async function saveSettings(s: Settings): Promise<void> {
  await writeRaw(KEYS.settings, JSON.stringify(s));
}
