// из votchina: src/state/crashlog.ts @ 83b344d — журнал сбоев (путь к 1.0, часть В1): последние ошибки на телефоне —
// чтобы игрок мог прислать не «вылетело», а что и где. Никуда не уходит сам: только в отчёт, который игрок видит целиком
// и отправляет своими руками (src/screens/ReportScreen.tsx). Изменено: хранилище — строки src/state/storage.ts, разбор
// строки — отдельной функцией (её читает тест образцов сохранений).
//
// Модуль без React Native: его гоняют тесты под Bun.
import { KEYS, readRaw, writeRaw } from './storage';

export type CrashKind = 'crash' | 'error' | 'render' | 'code' | 'web';
export interface CrashEntry { at: number; kind: CrashKind; message: string }

/** Сколько записей хранить и какой длины каждая. */
export const CRASH_MAX = 30;
const LEN = 1000;
const STACK_LINES = 8;

/** Текст ошибки для журнала: где, имя, сообщение и начало стека. */
export function crashText(err: unknown, where?: string): string {
  const e = err as { name?: string; message?: string; stack?: string } | null;
  const head = e && typeof e === 'object'
    ? `${e.name ?? 'Error'}: ${e.message ?? ''}`
    : String(err);
  const stack = e && typeof e === 'object' && e.stack ? e.stack.split('\n').slice(1, 1 + STACK_LINES).join('\n') : '';
  return [where, head, stack].filter(Boolean).join('\n').slice(0, LEN);
}

/** Журнал из строки хранилища: не тот вид — пустой; чужие записи отброшены. */
export function parseCrashlog(raw: string | null): CrashEntry[] {
  try {
    const x = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(x)) return [];
    return x.filter((e): e is CrashEntry => Boolean(e) && typeof e.at === 'number' && typeof e.kind === 'string' && typeof e.message === 'string');
  } catch {
    return [];
  }
}

// записи идут друг за другом: две ошибки подряд не должны затереть друг друга
let queue: Promise<void> = Promise.resolve();

export function logError(kind: CrashKind, err: unknown, where?: string): void {
  const entry: CrashEntry = { at: Date.now(), kind, message: crashText(err, where) };
  queue = queue.then(async () => {
    const list = parseCrashlog(await readRaw(KEYS.crashlog));
    await writeRaw(KEYS.crashlog, JSON.stringify([...list, entry].slice(-CRASH_MAX)));
  }).catch(() => {});
}

/** Дождаться, пока журнал записан (тесты и образцы сохранений). */
export function crashlogWritten(): Promise<void> {
  return queue;
}

/** Журнал; `null` — не прочитался (в отчёте так и будет сказано). */
export async function readCrashlog(): Promise<CrashEntry[] | null> {
  try {
    await queue;
    return parseCrashlog(await readRaw(KEYS.crashlog));
  } catch {
    return null;
  }
}

/**
 * Ловушки при запуске. `ErrorUtils` есть в React Native (на вебе — нет); прежний обработчик вызывается дальше —
 * поведение сбоя не меняется. На вебе — `error` и `unhandledrejection`.
 */
export function installCrashHandlers(): void {
  const EU = (globalThis as { ErrorUtils?: { getGlobalHandler?: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler?: (h: (e: unknown, fatal?: boolean) => void) => void } }).ErrorUtils;
  if (EU?.getGlobalHandler && EU.setGlobalHandler) {
    const prev = EU.getGlobalHandler();
    EU.setGlobalHandler((e, fatal) => { logError(fatal ? 'crash' : 'error', e); prev?.(e, fatal); });
  }
  const w = (globalThis as { window?: { addEventListener?: (t: string, f: (e: { error?: unknown; message?: string; reason?: unknown }) => void) => void } }).window;
  if (w?.addEventListener) {
    w.addEventListener('error', e => logError('web', e.error ?? e.message));
    w.addEventListener('unhandledrejection', e => logError('web', e.reason));
  }
}
