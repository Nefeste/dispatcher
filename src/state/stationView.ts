// Вид станции между сменами (срез, часть С2; docs/08-game-design.md, §15): что лежит на столе — письмо старшего врача,
// табель бригад следующей смены, журнал фонда, укладки — и какие решения можно принять сейчас. Только то, что знает
// станция (`Station` — из итогов смен), без правды о больных. Без React: проверяется тестом.
import { DB } from '../content/generated/db';
import type { Db } from '../content/types';
import { KIT, KIT_PLUS, RESTOCK, RESTOCK_FAST } from '../engine/rules';
import { canDecide, capFor, consequenceOf, type Decision, type Entry, type Letter, missingOf, priceOf, STATION, type Station, type StationRefusal } from '../engine/station';
import { crewNo } from './callView';
import { firstWeek, weekShifts } from './week';

export interface RosterRow {
  no: number;
  /** вид бригады словом из базы */
  kind: string;
  base: string;
  /** бригада станции — выведена решением, а не записью смены */
  own: boolean;
  /** на сколько вызовов укладка и на сколько полная */
  kit: number;
  cap: number;
}

export interface Choice {
  d: Decision;
  /** подстанция новой бригады — коротким именем; у укладок — null */
  base: string | null;
  price: number;
  /** null — можно */
  no: StationRefusal | null;
}

/** Укладка бригады в «Закупках» (игра владельца 22.11.2026: выбирать, что докупать). */
export interface KitRow {
  crew: string;
  no: number;
  /** подстанция коротким именем */
  base: string;
  /** на сколько вызовов осталось и на сколько полная */
  kit: number;
  cap: number;
  /** цена пополнения до полной */
  price: number;
  /** бригада выходит на следующую смену — в заказе отмечена сразу */
  next: boolean;
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
  num: typeof STATION & { kit: number; restockMin: number; plusCalls: number; fastMin: number };
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
  /** укладки бригад, которым не хватает до полной: бригады следующей смены — первыми */
  kitRows: KitRow[];
  /** заказ пополнения на эти бригады: цена и можно ли (одно решение) */
  order: (crews: readonly string[]) => Choice;
  /** расширенная укладка — бригадам недели без неё; склад — подстанциям без него */
  plus: (Choice & { crewNo: number })[];
  stock: Choice[];
  /** журнал фонда, новые строки сверху */
  journal: JournalRow[];
}

/** Вид станции недели `of` (путь к 1.0, В2а); без недели — первой. */
export function stationView(st: Station, db: Db = DB, of: string = firstWeek(db)): StationView {
  const week = weekShifts(db, of);
  const nOf = (id: string) => db.shifts[id]?.week?.n ?? 0;
  // пройденные смены этой недели: у каждой недели своя станция, чужих смен в ней не бывает — но считаем только свои
  const mine = st.done.filter(id => db.shifts[id]?.week?.of === of);
  const last = mine.length ? Math.max(...mine.map(nOf)) : 0;
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
        ...nextShift.crews.map(c => ({ no: crewNo(c.id), kind: kindName(c.id, c.kind), base: baseName(c.base), own: false, kit: st.kits[c.id] ?? capFor(st, c.id), cap: capFor(st, c.id) })),
        ...st.extra.map(c => ({ no: crewNo(c.id), kind: kindName(c.id, c.kind), base: baseName(c.base), own: true, kit: st.kits[c.id] ?? capFor(st, c.id), cap: capFor(st, c.id) })),
      ]
    : [];
  const choice = (d: Decision): Choice => ({
    d, base: d.d === 'crew' || d.d === 'stock' ? baseName(d.base) : null, price: priceOf(d, st), no: nextShift ? canDecide(st, d) : 'noShift',
  });
  const onNext = new Set(nextShift ? [...nextShift.crews.map(c => c.id), ...st.extra.map(c => c.id)] : []);
  const kitRows: KitRow[] = [...all]
    .filter(([id]) => missingOf(st, id) > 0)
    .map(([id, c]) => ({ crew: id, no: crewNo(id), base: baseName(c.base), kit: st.kits[id], cap: capFor(st, id), price: missingOf(st, id) * STATION.kitCall, next: onNext.has(id) }))
    .sort((a, b) => Number(b.next) - Number(a.next) || a.no - b.no);
  const bases = city.bases.map(b => b.id);
  return {
    num: { ...STATION, kit: KIT, restockMin: RESTOCK / 60_000, plusCalls: KIT_PLUS, fastMin: RESTOCK_FAST / 60_000 },
    fund: st.fund,
    left: Math.max(0, STATION.decisions - st.decided),
    letter: st.letter ? { ...st.letter, n: nOf(st.letter.after), day: db.shifts[st.letter.after]?.week?.day ?? '' } : null,
    next: nextShift ? { id: nextShift.id, n: nextShift.week!.n, day: nextShift.week!.day, roster } : null,
    complete: week.every(s => st.done.includes(s.id)),
    short: roster.filter(r => r.kit < r.cap),
    crew: bases.map(base => choice({ d: 'crew', base })),
    resus: bases.flatMap(base => {
      const id = [...all].filter(([i, c]) => c.base === base && c.kind === 'crew.general' && !st.trained.includes(i)).sort((a, b) => crewNo(a[0]) - crewNo(b[0]))[0]?.[0];
      return id ? [{ ...choice({ d: 'resus', crew: id }), base: baseName(base), crewNo: crewNo(id) }] : [];
    }),
    kitRows,
    order: crews => choice({ d: 'kits', crews }),
    plus: [...all].filter(([id]) => !st.plus.includes(id)).sort((a, b) => crewNo(a[0]) - crewNo(b[0])).map(([id]) => ({ ...choice({ d: 'plus', crew: id }), crewNo: crewNo(id) })),
    stock: bases.map(base => choice({ d: 'stock', base })),
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
