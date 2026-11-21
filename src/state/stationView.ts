// Вид станции между сменами (срез, часть С2; docs/08-game-design.md, §15): что лежит на столе — письмо старшего врача,
// табель бригад следующей смены, журнал фонда, укладки — и какие решения можно принять сейчас. Только то, что знает
// станция (`Station` — из итогов смен), без правды о больных. Без React: проверяется тестом.
import { DB } from '../content/generated/db';
import type { Db } from '../content/types';
import { KIT, RESTOCK } from '../engine/rules';
import { canDecide, consequenceOf, type Decision, type Entry, type Letter, priceOf, STATION, type Station, type StationRefusal } from '../engine/station';
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
  /** все смены недели приняты станцией: дальше — итог недели (срез, С8) */
  complete: boolean;
  /** бригады с неполной укладкой в табеле следующей смены */
  short: RosterRow[];
  crew: Choice[];
  /** реанимобиль на подстанцию: обучить первую по номеру общепрофильную бригаду подстанции (срез, С4) */
  resus: (Choice & { crewNo: number })[];
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
  // обученная станцией — реанимационная (срез, С4)
  const kindName = (id: string, kind: string) => db.crews[st.trained.includes(id) ? 'crew.resus' : kind].name;
  // бригады станции за неделю: номер, вид, подстанция — из записей смен и свои
  const all = new Map<string, { kind: string; base: string }>();
  for (const sh of week) for (const c of sh.crews) all.set(c.id, { kind: c.kind, base: c.base });
  for (const c of st.extra) all.set(c.id, { kind: c.kind, base: c.base });
  const roster: RosterRow[] = nextShift
    ? [
        ...nextShift.crews.map(c => ({ no: crewNo(c.id), kind: kindName(c.id, c.kind), base: baseName(c.base), own: false, kit: st.kits[c.id] ?? KIT })),
        ...st.extra.map(c => ({ no: crewNo(c.id), kind: kindName(c.id, c.kind), base: baseName(c.base), own: true, kit: st.kits[c.id] ?? KIT })),
      ]
    : [];
  const choice = (d: Decision): Choice => ({
    d, base: d.d === 'crew' ? baseName(d.base) : null, price: priceOf(d), no: nextShift ? canDecide(st, d) : 'noShift',
  });
  const bases = city.bases.map(b => b.id);
  return {
    num: { ...STATION, kit: KIT, restockMin: RESTOCK / 60_000 },
    fund: st.fund,
    left: Math.max(0, STATION.decisions - st.decided),
    letter: st.letter ? { ...st.letter, n: nOf(st.letter.after), day: db.shifts[st.letter.after]?.week?.day ?? '' } : null,
    next: nextShift ? { id: nextShift.id, n: nextShift.week!.n, day: nextShift.week!.day, roster } : null,
    complete: week.every(s => st.done.includes(s.id)),
    short: roster.filter(r => r.kit < KIT),
    crew: bases.map(base => choice({ d: 'crew', base })),
    resus: bases.flatMap(base => {
      const id = [...all].filter(([i, c]) => c.base === base && c.kind === 'crew.general' && !st.trained.includes(i)).sort((a, b) => crewNo(a[0]) - crewNo(b[0]))[0]?.[0];
      return id ? [{ ...choice({ d: 'resus', crew: id }), base: baseName(base), crewNo: crewNo(id) }] : [];
    }),
    kits: choice({ d: 'kits' }),
    journal: st.journal.map(e => ({ ...e, n: nOf(e.after), no: e.crew ? crewNo(e.crew) : null, baseName: e.base ? baseName(e.base) : null })).reverse(),
  };
}

/** Письмо в начале смены (срез, С3; спецификация, §4, «последствие доходит»): тяжёлая ошибка прошлой смены —
 *  служебная проверка или отказ в выезде с поводом — на вводе следующей по неделе смены. Иначе — null. */
export interface IntroNote {
  /** номер смены недели, о которой письмо */
  n: number;
  inquiries: number[];
  refusals: number;
}

export function introNote(st: Station, shiftId: string, db: Db = DB): IntroNote | null {
  const c = consequenceOf(st);
  const n = db.shifts[shiftId]?.week?.n;
  const after = c ? db.shifts[c.after]?.week?.n : undefined;
  if (!c || n === undefined || after === undefined || n !== after + 1) return null;
  return { n: after, inquiries: c.inquiries, refusals: c.refusals };
}
