// Журнал сбоев и отчёт об ошибке (путь к 1.0, В1; src/state/crashlog.ts, src/state/report.ts): мусор в хранилище не
// ломает журнал, отчёт — один текст в пределе письма, и обрезается журнал, а не слова игрока. Запись журнала в
// хранилище проверяет образец сохранений 0.25.0 (tools/test/saves.test.ts): там одна запись.
import { describe, expect, test } from 'bun:test';
import { crashText, parseCrashlog } from '../../src/state/crashlog';
import { REPORT_LOG, REPORT_MAX, buildReport } from '../../src/state/report';
import { T } from '../../src/i18n';

describe('журнал сбоев', () => {
  test('пусто, мусор и чужой вид — пустой журнал; чужие записи отброшены', () => {
    expect(parseCrashlog(null)).toEqual([]);
    expect(parseCrashlog('{не json')).toEqual([]);
    expect(parseCrashlog('{"at":1}')).toEqual([]);
    const ok = { at: 1, kind: 'error', message: 'Error: x' };
    expect(parseCrashlog(JSON.stringify([ok, { at: 'вчера', kind: 'error', message: 'y' }, null, 7]))).toEqual([ok]);
  });

  test('текст ошибки: где, имя и сообщение, начало стека; длина ограничена', () => {
    const e = new TypeError('нет карты');
    const t = crashText(e, 'PultScreen');
    expect(t.startsWith('PultScreen\nTypeError: нет карты')).toBe(true);
    expect(crashText('строка')).toBe('строка');
    expect(crashText(new Error('x'.repeat(5000))).length).toBe(1000);
  });
});

describe('отчёт об ошибке', () => {
  const base = {
    what: '', version: '0.25.0', build: 25, device: 'Android 14 · Xiaomi', screen: 'settings', shift: null, log: [],
    labels: T.bugReport.labels,
  };

  test('без слов игрока, смены и журнала — версия, телефон, экран и «журнал пуст»', () => {
    const text = buildReport(base);
    expect(text).toContain('0.25.0 (25)');
    expect(text).toContain('Android 14 · Xiaomi');
    expect(text).toContain(T.bugReport.labels.noLog);
    expect(text).not.toContain(T.bugReport.labels.what);
    expect(text).not.toContain(T.bugReport.labels.shift);
  });

  test('журнал не прочитался — так и сказано; смена — запись и время, без правды о больных', () => {
    const text = buildReport({ ...base, log: null, shift: 'shift.week-2 · 08:41' });
    expect(text).toContain(T.bugReport.labels.logUnread);
    expect(text).toContain('shift.week-2 · 08:41');
  });

  test('в отчёте — последние записи журнала; длинный журнал обрезается, слова игрока целы', () => {
    const log = Array.from({ length: 30 }, (_, i) => ({ at: Date.UTC(2026, 10, 21, 8, i), kind: 'error' as const, message: `запись ${i} ${'·'.repeat(900)}` }));
    const text = buildReport({ ...base, what: 'Карта погасла после третьего вызова', log });
    expect(text.length).toBeLessThanOrEqual(REPORT_MAX);
    expect(text.startsWith(`${T.bugReport.labels.what}\nКарта погасла после третьего вызова`)).toBe(true);
    expect(text).not.toContain(`запись ${30 - REPORT_LOG - 1} `);
    expect(text).toContain(`запись ${30 - REPORT_LOG} `);
    expect(text).toContain('2026-11-21 08:20:00 error');
  });
});
