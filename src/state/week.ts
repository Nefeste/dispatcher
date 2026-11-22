// Недели (docs/08-game-design.md, §8; срез, часть С1; путь к 1.0, В2а — docs/specs/2026-11-v1.md): неделя — запись
// content/weeks/, семь смен по порядку в одном районе. Следующая смена открывается, когда пройдена предыдущая — с любым
// итогом; следующая неделя — когда у каждой смены предыдущей есть итог; пройдена — у смены есть лучший итог
// (src/state/progress.ts). Без React: проверяется тестом.
import { DB } from '../content/generated/db';
import type { Db, ShiftSetup, WeekDef } from '../content/types';
import type { Best } from './progress';

export interface WeekRow {
  id: string;
  n: number;
  day: string;
  what: string;
  /** начало и конец, секунды от полуночи (конец может быть за полночью) */
  from: number;
  to: number;
  best: Best | null;
  open: boolean;
}

/** Недели по порядку. */
export function weeksOf(db: Db = DB): WeekDef[] {
  return Object.values(db.weeks).sort((a, b) => a.order - b.order);
}

/** Первая неделя — с неё начинается игра; у её станции и журнала — прежние ключи хранилища. */
export function firstWeek(db: Db = DB): string {
  return weeksOf(db)[0].id;
}

/** Неделя смены; смена не из недели — null. */
export function weekOfShift(shiftId: string, db: Db = DB): string | null {
  return db.shifts[shiftId]?.week?.of ?? null;
}

/** Смены недели по номеру. */
export function weekShifts(db: Db = DB, week: string = firstWeek(db)): ShiftSetup[] {
  return (db.weeks[week]?.shifts ?? []).map(id => db.shifts[id]);
}

/** У каждой смены недели есть итог. */
export function weekPlayed(best: Readonly<Record<string, Best>>, week: string, db: Db = DB): boolean {
  return weekShifts(db, week).every(s => Boolean(best[s.id]));
}

/** Неделя открыта: первая — всегда, следующая — когда у каждой смены предыдущей есть итог. */
export function weekOpen(best: Readonly<Record<string, Best>>, week: string, db: Db = DB): boolean {
  const all = weeksOf(db);
  const i = all.findIndex(w => w.id === week);
  return i === 0 || (i > 0 && weekPlayed(best, all[i - 1].id, db));
}

/** Строки выбора смены по лучшим итогам; закрытая неделя — все её смены закрыты. */
export function weekRows(best: Readonly<Record<string, Best>>, db: Db = DB, week: string = firstWeek(db)): WeekRow[] {
  const shifts = weekShifts(db, week);
  const open = weekOpen(best, week, db);
  return shifts.map((s, i) => ({
    id: s.id, n: s.week!.n, day: s.week!.day, what: s.week!.what, from: s.start, to: s.start + s.length,
    best: best[s.id] ?? null,
    open: open && (i === 0 || Boolean(best[shifts[i - 1].id])),
  }));
}
