// Вид станции между сменами (срез, часть С2; docs/08-game-design.md, §15): что лежит на столе — письмо старшего врача,
// табель бригад следующей смены, журнал фонда, укладки — и какие решения можно принять сейчас. Только то, что знает
// станция (`Station` — из итогов смен), без правды о больных. Без React: проверяется тестом.
import { DB } from '../content/generated/db';
import type { Db } from '../content/types';
import { KIT, RESTOCK } from '../engine/rules';
import { canDecide, CREW_PRICE, type Decision, type Entry, type Letter, STATION, type Station, type StationRefusal } from '../engine/station';
import { crewNo } from './callView';
import { weekShifts } from './week';

export interface RosterRow {
  no: number;
  /** вид бригады словом из базы */
  kind: string;
  base: string;
  /** бригада станции — выведена решением, а не записью смены */
  own: boolean;
  /** на сколько вызовов укладка */
  kit: number;
}

export interface Choice {
  d: Decision;
  /** подстанция новой бригады — коротким именем; у укладок — null */
  base: string | null;
  price: number;
  /** null — можно */
  no: StationRefusal | null;
}

export interface JournalRow extends Entry {
  /** номер смены недели, после которой */
  n: number;
  /** у бригады: её номер и подстанция коротким именем */
  no: number | null;
  baseName: string | null;
}

export interface StationView {
  /** числа станции для слов — из движка, не из строк (§15 геймдизайна) */
  num: typeof STATION & { kit: number; restockMin: number };
  fund: number;
  /** сколько решений осталось в этом перерыве */
  left: number;
  /** письмо после последней смены, её номер в неделе и день */
  letter: (Letter & { n: number; day: string }) | null;
  /** следующая смена недели — её номер, день и табель; неделя пройдена — null */
  next: { id: string; n: number; day: string; roster: RosterRow[] } | null;
  /** бригады с неполной укладкой в табеле следующей смены */
  short: RosterRow[];
  crew: Choice[];
  kits: Choice;
  /** журнал фонда, новые строки сверху */
  journal: JournalRow[];
}

export function stationView(st: Station, db: Db = DB): StationView {
  const week = weekShifts(db);
  const nOf = (id: string) => db.shifts[id]?.week?.n ?? 0;
  const last = st.done.length ? Math.max(...st.done.map(nOf)) : 0;
  const nextShift = week.find(s => s.week!.n === last + 1) ?? null;
  const city = db.cities[(nextShift ?? week[0]).city];
  const baseName = (id: string) => city.bases.find(b => b.id === id)?.short ?? id;
  const roster: RosterRow[] = nextShift
    ? [
        ...nextShift.crews.map(c => ({ no: crewNo(c.id), kind: db.crews[c.kind].name, base: baseName(c.base), own: false, kit: st.kits[c.id] ?? KIT })),
        ...st.extra.map(c => ({ no: crewNo(c.id), kind: db.crews[c.kind].name, base: baseName(c.base), own: true, kit: st.kits[c.id] ?? KIT })),
      ]
    : [];
  const choice = (d: Decision): Choice => ({
    d, base: d.d === 'crew' ? baseName(d.base) : null, price: d.d === 'crew' ? CREW_PRICE : STATION.kits, no: nextShift ? canDecide(st, d) : 'noShift',
  });
  const bases = city.bases.map(b => b.id);
  return {
    num: { ...STATION, kit: KIT, restockMin: RESTOCK / 60_000 },
    fund: st.fund,
    left: Math.max(0, STATION.decisions - st.decided),
    letter: st.letter ? { ...st.letter, n: nOf(st.letter.after), day: db.shifts[st.letter.after]?.week?.day ?? '' } : null,
    next: nextShift ? { id: nextShift.id, n: nextShift.week!.n, day: nextShift.week!.day, roster } : null,
    short: roster.filter(r => r.kit < KIT),
    crew: bases.map(base => choice({ d: 'crew', base })),
    kits: choice({ d: 'kits' }),
    journal: st.journal.map(e => ({ ...e, n: nOf(e.after), no: e.crew ? crewNo(e.crew) : null, baseName: e.base ? baseName(e.base) : null })).reverse(),
  };
}
