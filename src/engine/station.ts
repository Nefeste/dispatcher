// Станция между сменами (срез, часть С2; docs/08-game-design.md, §15; решение владельца #24, вариант 2): фонд из итогов
// смен, письмо старшего врача, решения за рабочим местом — не больше трёх за перерыв. Станция знает о смене только её
// итог (`ShiftReport`: три числа, жалобы, ошибки с ценой, укладки) — правду о больных она не читает (критерий 3 среза).
// Чистый TypeScript: состояние — обычный объект, каждая функция возвращает новое; та же цепочка итогов и решений — та же
// станция байт в байт (золотая неделя).
import { capOf } from './crews';
import { type Mistake, review } from './review';
import { KIT, KIT_PLUS, NORM_URGENT } from './rules';
import type { Lineup, Shift, ShiftCtx } from './shift';
import { totals } from './totals';

/** Числа станции — копия §15 геймдизайна, там они живут. Рубли. */
export const STATION = {
  perShift: 100_000,
  perInNorm: 10_000,
  thanks: 30_000,
  complaint: 15_000,
  inquiry: 50_000,
  carB: 200_000,
  feldsher: 60_000,
  /** пополнить укладку — за каждый вызов до полной (игра владельца 22.11.2026: выбирать, что докупать; §15) */
  kitCall: 2_500,
  /** расширенная укладка бригаде: +KIT_PLUS вызовов до конца недели */
  plus: 40_000,
  /** склад на подстанции: пополнение там — RESTOCK_FAST */
  stock: 60_000,
  /** решений за перерыв */
  decisions: 3,
  /** бригад станции сверх записей смен — гараж подстанций */
  extraMax: 2,
  /** реанимобиль: машина класса C и обучение общепрофильной бригады до реанимационной (срез, С4) */
  carC: 400_000,
  train: 120_000,
  /** реанимобилей станции — места в гараже для машин класса C */
  trainedMax: 2,
} as const;

/** Новая общепрофильная фельдшерская бригада: машина класса B и два фельдшера (388н, прил. 2, п. 7). */
export const CREW_PRICE = STATION.carB + 2 * STATION.feldsher;

/** Номера бригад станции: в записях недели — с первой по шестую (тест недели это держит). */
export const EXTRA_IDS = ['crew.7', 'crew.8'] as const;

/** Что станция знает о смене: из итога и разбора закрытой смены. */
export interface ShiftReport {
  shift: string;
  emergency: number;
  inNorm: number;
  /** неотложные, которых бригада ждала дольше двух часов (или не дождалась до конца смены) */
  longWaits: number;
  /** «без выезда», когда повод был */
  refusals: number;
  /** ошибок разбора с ценой в минутах */
  costly: number;
  /** смертей до приезда бригады (третья ступень исхода, срез С3) */
  deaths: number;
  /** служебных проверок: смерть, где решение шло против услышанного — угроза прозвучала, а форма неотложная; «без
   *  выезда» при поводе; неотложному бригаду, пока ждали экстренные (§15 геймдизайна) — номера вызовов */
  inquiries: number[];
  /** сколько вызовов осталось в укладке каждой бригады; пополняющая — полная */
  kits: Record<string, number>;
}

export function reportOf(ctx: ShiftCtx, s: Shift): ShiftReport {
  const t = totals(ctx, s);
  const r = review(ctx, s);
  let longWaits = 0, refusals = 0, costly = 0, deaths = 0;
  const inquiries: number[] = [];
  for (const c of r.calls) {
    if (c.outcome.form === 'urgent' && c.decided !== 'none' && (c.outcome.wait === null || c.outcome.wait > NORM_URGENT)) longWaits++;
    for (const m of c.mistakes) {
      if (m.m.kind === 'noDispatch') refusals++;
      if (m.cost > 0) costly++;
    }
    if (c.outcome.died) {
      deaths++;
      if (c.mistakes.some(m => AGAINST_HEARD.includes(m.m.kind))) inquiries.push(Number(c.id.split('.')[1]));
    }
  }
  const kits: Record<string, number> = {};
  for (const c of s.crews) kits[c.id] = c.state === 'restock' ? capOf(c) : c.kit;
  return { shift: s.setup, emergency: t.emergency, inNorm: t.inNorm, longWaits, refusals, costly, deaths, inquiries, kits };
}

/** Ошибки, где решение шло против услышанного: из-за них смерть ведёт к служебной проверке. */
const AGAINST_HEARD: readonly Mistake['kind'][] = ['underTriage', 'noDispatch', 'order'];

/** Письмо старшего врача после смены: итог, благодарность, жалобы родных. Слова — src/i18n (T.station.letter). */
export interface Letter {
  after: string;
  emergency: number;
  inNorm: number;
  /** доход смены, без благодарности и жалоб */
  income: number;
  thanks: boolean;
  longWaits: number;
  refusals: number;
  /** смертей до приезда бригады; служебные проверки — номера вызовов */
  deaths: number;
  inquiries: number[];
  /** вычет за жалобы и служебные проверки, рубли */
  fine: number;
}

export type EntryKind = 'shift' | 'thanks' | 'complaint' | 'inquiry' | 'crew' | 'resus' | 'kits' | 'plus' | 'stock';

/** Строка журнала фонда: что пришло или ушло, рубли со знаком. */
export interface Entry {
  kind: EntryKind;
  amount: number;
  /** после какой смены */
  after: string;
  /** для бригады — какая и где */
  crew?: string;
  base?: string;
  /** пополненные укладки — каких бригад */
  crews?: string[];
}

export interface StationCrew {
  id: string;
  kind: 'crew.general';
  base: string;
}

export interface Station {
  fund: number;
  extra: StationCrew[];
  /** общепрофильные бригады, обученные до реанимационных и пересаженные на машину класса C (срез, С4): номера */
  trained: string[];
  /** укладки бригад после последней смены; нет записи — полная */
  kits: Record<string, number>;
  /** бригады с расширенной укладкой и подстанции со складом (игра владельца 22.11.2026, §15) */
  plus: string[];
  stock: string[];
  journal: Entry[];
  letter: Letter | null;
  /** смены, итог которых станция уже приняла: повтор смены фонд не меняет */
  done: string[];
  /** решений в этом перерыве */
  decided: number;
}

export function newStation(): Station {
  return { fund: 0, extra: [], trained: [], kits: {}, plus: [], stock: [], journal: [], letter: null, done: [], decided: 0 };
}

/** Полная укладка бригады этой станции: с расширенной — больше. */
export function capFor(st: Pick<Station, 'plus'>, crew: string): number {
  return KIT + (st.plus.includes(crew) ? KIT_PLUS : 0);
}

/** Сколько вызовов не хватает до полной укладки бригады. */
export function missingOf(st: Pick<Station, 'plus' | 'kits'>, crew: string): number {
  const n = st.kits[crew];
  return n === undefined ? 0 : Math.max(0, capFor(st, crew) - n);
}

/** Итог смены пришёл на станцию: доход, письмо, укладки. Повтор пройденной смены станцию не меняет. */
export function afterShift(st: Station, rep: ShiftReport): Station {
  if (st.done.includes(rep.shift)) return st;
  const income = STATION.perShift + STATION.perInNorm * rep.inNorm;
  const thanks = rep.costly === 0;
  const complaints = rep.longWaits + rep.refusals;
  const journal: Entry[] = [...st.journal, { kind: 'shift', amount: income, after: rep.shift }];
  if (thanks) journal.push({ kind: 'thanks', amount: STATION.thanks, after: rep.shift });
  for (let i = 0; i < complaints; i++) journal.push({ kind: 'complaint', amount: -STATION.complaint, after: rep.shift });
  for (let i = 0; i < rep.inquiries.length; i++) journal.push({ kind: 'inquiry', amount: -STATION.inquiry, after: rep.shift });
  const fine = complaints * STATION.complaint + rep.inquiries.length * STATION.inquiry;
  const fund = st.fund + income + (thanks ? STATION.thanks : 0) - fine;
  const kits: Record<string, number> = { ...st.kits };
  for (const [id, n] of Object.entries(rep.kits)) {
    if (n >= capFor(st, id)) delete kits[id];
    else kits[id] = n;
  }
  return {
    ...st, fund, kits, journal,
    letter: {
      after: rep.shift, emergency: rep.emergency, inNorm: rep.inNorm, income, thanks, longWaits: rep.longWaits, refusals: rep.refusals,
      deaths: rep.deaths, inquiries: rep.inquiries, fine,
    },
    done: [...st.done, rep.shift], decided: 0,
  };
}

/** Решение за рабочим местом. Укладки — заказ на выбранные бригады (игра владельца 22.11.2026: выбирать, что
 *  докупать): цена — за каждый вызов до полной; расширенная укладка — бригаде; склад — подстанции (§15). */
export type Decision =
  | { d: 'crew'; base: string }
  | { d: 'kits'; crews: readonly string[] }
  | { d: 'resus'; crew: string }
  | { d: 'plus'; crew: string }
  | { d: 'stock'; base: string };

/** Почему решение нельзя: слова — src/i18n (T.station.no). */
export type StationRefusal = 'noShift' | 'limit' | 'fund' | 'garage' | 'full' | 'trained' | 'none' | 'has';

/** Реанимобиль: машина класса C (388н, прил. 2, п. 9) и обучение людей общепрофильной бригады. */
export const RESUS_PRICE = STATION.carC + STATION.train;

export function priceOf(d: Decision, st: Pick<Station, 'plus' | 'kits'>): number {
  if (d.d === 'kits') return d.crews.reduce((a, c) => a + missingOf(st, c) * STATION.kitCall, 0);
  return d.d === 'crew' ? CREW_PRICE : d.d === 'resus' ? RESUS_PRICE : d.d === 'plus' ? STATION.plus : STATION.stock;
}

/** Можно ли решение сейчас; null — можно. */
export function canDecide(st: Station, d: Decision): StationRefusal | null {
  if (!st.done.length) return 'noShift';
  if (st.decided >= STATION.decisions) return 'limit';
  if (d.d === 'crew' && st.extra.length >= STATION.extraMax) return 'garage';
  if (d.d === 'kits' && !Object.keys(st.kits).length) return 'full';
  if (d.d === 'kits' && (!d.crews.length || d.crews.some(c => missingOf(st, c) === 0))) return 'none';
  if (d.d === 'plus' && st.plus.includes(d.crew)) return 'has';
  if (d.d === 'stock' && st.stock.includes(d.base)) return 'has';
  if (d.d === 'resus' && st.trained.length >= STATION.trainedMax) return 'garage';
  if (d.d === 'resus' && st.trained.includes(d.crew)) return 'trained';
  if (st.fund < priceOf(d, st)) return 'fund';
  return null;
}

/** Решение за рабочим местом. Нельзя — станция та же и почему. */
export function decide(st: Station, d: Decision): Station | StationRefusal {
  const why = canDecide(st, d);
  if (why) return why;
  const after = st.done[st.done.length - 1];
  const price = priceOf(d, st);
  if (d.d === 'crew') {
    const id = EXTRA_IDS[st.extra.length];
    return {
      ...st, fund: st.fund - price, extra: [...st.extra, { id, kind: 'crew.general', base: d.base }],
      journal: [...st.journal, { kind: 'crew', amount: -price, after, crew: id, base: d.base }], decided: st.decided + 1,
    };
  }
  if (d.d === 'resus') {
    return {
      ...st, fund: st.fund - price, trained: [...st.trained, d.crew],
      journal: [...st.journal, { kind: 'resus', amount: -price, after, crew: d.crew }], decided: st.decided + 1,
    };
  }
  if (d.d === 'plus') {
    // укладка становится больше сразу: полная — полная и дальше, неполная — на KIT_PLUS вызовов полнее
    const kits = { ...st.kits };
    const plus = [...st.plus, d.crew];
    if (kits[d.crew] !== undefined) {
      kits[d.crew] += KIT_PLUS;
      if (kits[d.crew] >= capFor({ plus }, d.crew)) delete kits[d.crew];
    }
    return { ...st, fund: st.fund - price, plus, kits, journal: [...st.journal, { kind: 'plus', amount: -price, after, crew: d.crew }], decided: st.decided + 1 };
  }
  if (d.d === 'stock') {
    return { ...st, fund: st.fund - price, stock: [...st.stock, d.base], journal: [...st.journal, { kind: 'stock', amount: -price, after, base: d.base }], decided: st.decided + 1 };
  }
  const kits = { ...st.kits };
  for (const c of d.crews) delete kits[c];
  return { ...st, fund: st.fund - price, kits, journal: [...st.journal, { kind: 'kits', amount: -price, after, crews: [...d.crews] }], decided: st.decided + 1 };
}

/** Тяжёлая ошибка прошлой смены — служебная проверка или отказ в выезде, когда повод был (спецификация среза, §4,
 *  «последствие доходит»): письмо старшего врача в начале следующей смены, всегда. Нет — null. */
export function consequenceOf(st: Station): Pick<Letter, 'after' | 'inquiries' | 'refusals'> | null {
  const l = st.letter;
  if (!l || (!l.inquiries.length && !l.refusals)) return null;
  return { after: l.after, inquiries: l.inquiries, refusals: l.refusals };
}

/** Что станция даёт следующей смене: свои бригады и укладки. */
export function lineupOf(st: Station): Lineup {
  return { extra: st.extra, kits: st.kits, trained: st.trained, plus: st.plus, stock: st.stock };
}
