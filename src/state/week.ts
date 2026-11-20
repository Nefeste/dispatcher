// «Первая неделя» (docs/08-game-design.md, §8; срез, docs/specs/2026-11-vertical-slice.md, часть С1): семь смен по
// порядку из записей content/shifts/week-*.yaml. Следующая открывается, когда пройдена предыдущая — с любым итогом;
// пройдена — у смены есть лучший итог (src/state/progress.ts). Без React: проверяется тестом.
import { DB } from '../content/generated/db';
import type { ShiftSetup } from '../content/types';
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

/** Смены недели по номеру. */
export function weekShifts(db = DB): ShiftSetup[] {
  return Object.values(db.shifts).filter(s => s.week).sort((a, b) => a.week!.n - b.week!.n);
}

/** Строки выбора смены по лучшим итогам. */
export function weekRows(best: Readonly<Record<string, Best>>, db = DB): WeekRow[] {
  const shifts = weekShifts(db);
  return shifts.map((s, i) => ({
    id: s.id, n: s.week!.n, day: s.week!.day, what: s.week!.what, from: s.start, to: s.start + s.length,
    best: best[s.id] ?? null,
    open: i === 0 || Boolean(best[shifts[i - 1].id]),
  }));
}
