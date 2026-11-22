// Несколько недель (путь к 1.0, В2а; docs/specs/2026-11-v1.md): неделя — запись content/weeks/, у каждой недели своя
// станция и журнал; следующая неделя открывается, когда у каждой смены предыдущей есть итог; «Неделя заново» — только
// своей недели. Вторая неделя здесь — из записей первой: своих записей до ответа на #47 нет.
import { describe, expect, test } from 'bun:test';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DB } from '../../src/content/generated/db';
import type { Db } from '../../src/content/types';
import { newStation } from '../../src/engine/station';
import { stationView } from '../../src/state/stationView';
import { weekEnd } from '../../src/state/weekEnd';
import { newWeekLog } from '../../src/state/weekLog';
import { firstWeek, weekOfShift, weekOpen, weekPlayed, weekRows, weekShifts, weeksOf } from '../../src/state/week';
import { buildDb } from '../content/build';

const ROOT = join(import.meta.dir, '../..');
const best = { emergency: 3, inNorm: 3, urgentMedian: 600_000, accepted: 5 };

/** Вторая неделя из смен первой: свои номера смен, неделя `week.test`. */
function twoWeeks(): Db {
  const shifts = { ...DB.shifts };
  const ids: string[] = [];
  for (const s of weekShifts()) {
    const id = s.id.replace('shift.week-', 'shift.test-');
    shifts[id] = { ...s, id, week: { ...s.week!, of: 'week.test' } };
    ids.push(id);
  }
  return { ...DB, shifts, weeks: { ...DB.weeks, 'week.test': { id: 'week.test', order: 2, title: 'Вторая неделя', city: DB.weeks['week.first'].city, shifts: ids } } };
}

describe('недели — записи', () => {
  test('«Первая неделя»: семь смен по порядку, у каждой — своя неделя и место в списке', () => {
    expect(weeksOf().map(w => w.id)).toEqual(['week.first']);
    expect(firstWeek()).toBe('week.first');
    const w = DB.weeks['week.first'];
    expect(w.title).toBe('Первая неделя');
    expect(w.city).toBe('city.proto');
    expect(w.shifts).toEqual([1, 2, 3, 4, 5, 6, 7].map(n => `shift.week-${n}`));
    weekShifts().forEach((s, i) => {
      expect(s.week).toMatchObject({ of: 'week.first', n: i + 1 });
      expect(weekOfShift(s.id)).toBe('week.first');
    });
    expect(weekOfShift('shift.proto')).toBeNull();
  });

  test('сборка ловит: номер не на своём месте, смена в двух неделях, смена недели без недели, разные районы', () => {
    const dir = mkdtempSync(join(tmpdir(), 'weeks-'));
    try {
      cpSync(join(ROOT, 'content'), dir, { recursive: true });
      const f = join(dir, 'weeks/first.yaml');
      // смены 2 и 3 местами, смена 7 — ещё и во второй неделе, у второй — прототип без строки недели и то же место
      writeFileSync(f, readFileSync(f, 'utf8').replace('  - shift.week-2\n  - shift.week-3', '  - shift.week-3\n  - shift.week-2'));
      writeFileSync(join(dir, 'weeks/second.yaml'), 'order: 1\ntitle: "Вторая"\nshifts:\n  - shift.week-7\n  - shift.proto\n');
      const { errors } = buildDb(dir);
      expect(errors.some(e => e.includes('week.first: shift.week-3 is number 2 in the week, but its week.n is 3'))).toBe(true);
      expect(errors.some(e => e.includes('shift.week-7: in two weeks'))).toBe(true);
      expect(errors.some(e => e.includes('week.second: shift.proto has no week line'))).toBe(true);
      expect(errors.some(e => e.includes('weeks: order must not repeat'))).toBe(true);
      rmSync(join(dir, 'weeks/second.yaml'));
      rmSync(f);
      expect(buildDb(dir).errors.some(e => e.includes('shift.week-1: has a week line but no week lists it'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('две недели', () => {
  const db = twoWeeks();
  const firstDone = Object.fromEntries(weekShifts(db, 'week.first').map(s => [s.id, best]));

  test('вторая открывается, когда у каждой смены первой есть итог; до того её смены закрыты', () => {
    expect(weekOpen({}, 'week.first', db)).toBe(true);
    expect(weekOpen({}, 'week.test', db)).toBe(false);
    expect(weekRows({}, db, 'week.test').every(r => !r.open)).toBe(true);
    const six = { ...firstDone };
    delete six['shift.week-7'];
    expect(weekOpen(six, 'week.test', db)).toBe(false);
    expect(weekPlayed(firstDone, 'week.first', db)).toBe(true);
    expect(weekOpen(firstDone, 'week.test', db)).toBe(true);
    // внутри недели — по порядку, как в первой
    expect(weekRows(firstDone, db, 'week.test').map(r => r.open)).toEqual([true, false, false, false, false, false, false]);
    // строки первой недели — прежние
    expect(weekRows(firstDone, db).map(r => r.id)).toEqual(weekShifts().map(s => s.id));
  });

  test('станция и итог недели — по сменам своей недели', () => {
    const st = { ...newStation(), done: ['shift.test-1'] };
    expect(stationView(st, db, 'week.test').next?.id).toBe('shift.test-2');
    expect(stationView(st, db, 'week.first').next?.id).toBe('shift.week-1');
    const all = { ...newStation(), done: weekShifts(db, 'week.test').map(s => s.id) };
    expect(stationView(all, db, 'week.test').complete).toBe(true);
    expect(stationView(all, db, 'week.first').complete).toBe(false);
    const end = weekEnd(all, newWeekLog('', 0), {}, db, 'week.test');
    expect(end.complete).toBe(true);
    expect(end.rows.map(r => r.id)).toEqual(weekShifts(db, 'week.test').map(s => s.id));
  });

  test('хранилище: свои ключи у второй недели, у первой — прежние; «Неделя заново» не трогает другую', () => {
    const run = Bun.spawnSync(['bun', 'tools/test/two-weeks.ts'], { cwd: ROOT, env: process.env });
    expect(run.stderr.toString()).toBe('');
    expect(run.exitCode).toBe(0);
    const got = JSON.parse(run.stdout.toString()) as {
      keys: Record<string, { station: string; log: string }>; rows: string[];
      before: Record<string, { done: string[]; fund: number; log: string[] }>; after: Record<string, { done: string[]; fund: number; log: string[] }>;
    };
    expect(got.keys.first).toEqual({ station: 'dispatcher.station.v1', log: 'dispatcher.week.v1' });
    expect(got.keys.test).toEqual({ station: 'dispatcher.station.test.v1', log: 'dispatcher.week.test.v1' });
    expect(got.rows).toEqual(['dispatcher.station.test.v1', 'dispatcher.station.v1', 'dispatcher.week.test.v1', 'dispatcher.week.v1']);
    expect(got.before.first.done).toEqual(['shift.week-1']);
    expect(got.before.first.log).toEqual(['shift.week-1']);
    expect(got.before.test.done).toEqual(['shift.test-1', 'shift.test-2']);
    expect(got.before.test.log).toEqual(['shift.test-1', 'shift.test-2']);
    expect(got.after.first).toEqual(got.before.first);
    expect(got.after.test).toEqual({ done: [], fund: newStation().fund, log: [] });
  }, 60_000);
});
