// Телефон в памяти для образцов сохранений (путь к 1.0, В1; tools/test/saves.test.ts): хранилище игры —
// AsyncStorage, а его веб-реализация пишет в `window.localStorage` (@react-native-async-storage/async-storage 2.2.0,
// lib/module/AsyncStorage.js). Под Bun окна нет — подставляем своё, со строками в памяти. Ставить до первого обращения
// игры к хранилищу.

/** Поставить хранилище в памяти с этими строками; вернуть их таблицу — что игра запишет, будет в ней. */
export function memoryPhone(keys: Record<string, string> = {}): Map<string, string> {
  const rows = new Map(Object.entries(keys));
  const storage = {
    getItem: (k: string) => (rows.has(k) ? rows.get(k)! : null),
    setItem: (k: string, v: string) => { rows.set(k, String(v)); },
    removeItem: (k: string) => { rows.delete(k); },
    clear: () => rows.clear(),
    key: (i: number) => [...rows.keys()][i] ?? null,
    get length() { return rows.size; },
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  return rows;
}

/** Дать отработать отложенным записям игры (`void save()`, журнал сбоев). */
export const settle = () => new Promise<void>(r => setTimeout(r, 20));
