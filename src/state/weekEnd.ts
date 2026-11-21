// Итог недели (спецификация среза, §3, шаг 9; §5: «Итог недели и снимок недели: карта района с путями всех смен, семь
// итогов»): по смене — что сыграно на этой станции и лучший итог, что стало со станцией — фонд, свои бригады,
// реанимобили, письма. Только из того, что знают станция и журнал недели: правды о больных здесь нет (критерий 3 среза).
// Без React: проверяется тестом.
import { DB } from '../content/generated/db';
import type { Db } from '../content/types';
import type { Station } from '../engine/station';
import type { Best } from './progress';
import { weekShifts } from './week';
import type { WeekLog } from './weekLog';

export interface WeekEndRow {
  id: string;
  n: number;
  day: string;
  from: number;
  to: number;
  /** сыграно на этой станции — первый раз; ещё нет — null */
  played: { emergency: number; inNorm: number; deaths: number } | null;
  best: Best | null;
}

export interface WeekEndView {
  /** все семь смен приняты этой станцией */
  complete: boolean;
  rows: WeekEndRow[];
  total: { emergency: number; inNorm: number; deaths: number };
  fund: number;
  /** заработано сменами и премиями, ушло на решения, вычтено за жалобы и проверки — рубли */
  earned: number;
  spent: number;
  fined: number;
  /** свои бригады станции: номер и подстанция; обученные до реанимационных — номера */
  crews: { no: number; base: string }[];
  trained: number[];
  thanks: number;
  complaints: number;
  inquiries: number;
  /** решений за неделю */
  decisions: number;
}

const crewNo = (id: string) => Number(id.split('.')[1] ?? 0);

/** Итог недели этой станции. `complete` — неделя пройдена: тогда открывается экран итога. */
export function weekEnd(st: Station, log: WeekLog, best: Readonly<Record<string, Best>>, db: Db = DB): WeekEndView {
  const shifts = weekShifts(db);
  const city = db.cities[shifts[0].city];
  const baseName = (id: string) => city.bases.find(b => b.id === id)?.short ?? id;
  const rows = shifts.map(s => {
    const e = log.shifts.find(x => x.shift === s.id);
    return {
      id: s.id, n: s.week!.n, day: s.week!.day, from: s.start, to: s.start + s.length,
      played: e ? { emergency: e.emergency, inNorm: e.inNorm, deaths: e.deaths } : null,
      best: best[s.id] ?? null,
    };
  });
  const total = { emergency: 0, inNorm: 0, deaths: 0 };
  for (const r of rows) if (r.played) { total.emergency += r.played.emergency; total.inNorm += r.played.inNorm; total.deaths += r.played.deaths; }
  const sum = (kinds: readonly string[]) => st.journal.filter(e => kinds.includes(e.kind)).reduce((a, e) => a + e.amount, 0);
  const count = (kind: string) => st.journal.filter(e => e.kind === kind).length;
  return {
    complete: shifts.every(s => st.done.includes(s.id)),
    rows, total, fund: st.fund,
    earned: sum(['shift', 'thanks']),
    spent: -sum(['crew', 'resus', 'kits']),
    fined: -sum(['complaint', 'inquiry']),
    crews: st.extra.map(c => ({ no: crewNo(c.id), base: baseName(c.base) })),
    trained: st.trained.map(crewNo).sort((a, b) => a - b),
    thanks: count('thanks'),
    complaints: count('complaint'),
    inquiries: count('inquiry'),
    decisions: st.journal.filter(e => e.kind === 'crew' || e.kind === 'resus' || e.kind === 'kits').length,
  };
}
