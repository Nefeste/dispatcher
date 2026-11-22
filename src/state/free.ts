// «Свободная смена» (docs/08-game-design.md, §8: «После недели — «Свободная смена»: район, час, длина и число бригад по
// выбору игрока»; срез, часть С8в): район пока один, остальное — выбор игрока. Запись смены собирается из выбора, а
// выбор — из номера смены `shift.free.h<час>.l<часов>.g<общепрофильных>.r<реанимационных>`: так сохранение, разбор и
// лучший итог работают с ней как с записью из `content/shifts/`. Открывается, когда пройдена вся «Первая неделя» —
// у каждой её смены есть итог (неделя заново её не закрывает). Без React: проверяется тестом.
import { DB } from '../content/generated/db';
import type { Db, ShiftSetup } from '../content/types';
import type { Best } from './progress';
import { firstWeek, weekPlayed, weekShifts } from './week';

export interface FreeChoice {
  /** час начала, 0–23 */
  hour: number;
  /** длина, часов */
  hours: number;
  /** общепрофильных бригад */
  general: number;
  /** реанимационных бригад */
  resus: number;
}

/** Что можно выбрать: границы — как в сменах недели (§8 геймдизайна: от 3 до 5 общепрофильных и одна реанимационная). */
export const FREE = {
  hours: [2, 4] as readonly number[],
  general: { min: 3, max: 6 },
  resus: { min: 0, max: 1 },
  /** выбор по умолчанию — вечер пятницы недели: 19:00, два часа, пять и одна */
  first: { hour: 19, hours: 2, general: 5, resus: 1 } as FreeChoice,
} as const;

const PREFIX = 'shift.free';

export function freeId(c: FreeChoice): string {
  return `${PREFIX}.h${c.hour}.l${c.hours}.g${c.general}.r${c.resus}`;
}

/** Выбор из номера смены; не «свободная» или вне границ — null. */
export function freeOf(id: string): FreeChoice | null {
  const m = /^shift\.free\.h(\d{1,2})\.l(\d)\.g(\d)\.r(\d)$/.exec(id);
  if (!m) return null;
  const c = { hour: Number(m[1]), hours: Number(m[2]), general: Number(m[3]), resus: Number(m[4]) };
  const ok = c.hour >= 0 && c.hour <= 23 && FREE.hours.includes(c.hours)
    && c.general >= FREE.general.min && c.general <= FREE.general.max && c.resus >= FREE.resus.min && c.resus <= FREE.resus.max;
  return ok ? c : null;
}

/** Запись «свободной» смены: город и время года — как у недели, поток — 100 % кривой часа, все больницы, поликлиника в
 *  свои часы, учебных звонков нет. Бригады — по подстанциям по очереди, реанимационная — на последней. */
export function freeSetup(c: FreeChoice, db: Db = DB): ShiftSetup {
  const like = weekShifts(db)[0];
  const bases = db.cities[like.city].bases.map(b => b.id);
  const crews: ShiftSetup['crews'] = [];
  for (let i = 0; i < c.general; i++) crews.push({ id: `crew.${crews.length + 1}`, kind: 'crew.general', base: bases[i % bases.length] });
  for (let i = 0; i < c.resus; i++) crews.push({ id: `crew.${crews.length + 1}`, kind: 'crew.resus', base: bases[(bases.length - 1 - i) % bases.length] });
  return {
    id: freeId(c), city: like.city, start: c.hour * 3600, length: c.hours * 3600, season: like.season, crews, script: [],
    flowPct: 100, hospitals: null, clinic: true, week: null,
  };
}

/** Запись смены по номеру: из содержания или «свободная»; нет такой — null. */
export function setupOf(id: string, db: Db = DB): ShiftSetup | null {
  if (db.shifts[id]) return db.shifts[id];
  const c = freeOf(id);
  return c ? freeSetup(c, db) : null;
}

/** База для движка: со «свободной» сменой, если номер — её (движок ищет запись в `db.shifts`). */
export function dbFor(id: string, db: Db = DB): Db {
  if (db.shifts[id]) return db;
  const c = freeOf(id);
  return c ? { ...db, shifts: { ...db.shifts, [id]: freeSetup(c, db) } } : db;
}

/** Открыта ли «Свободная смена»: у каждой смены первой недели есть итог. */
export function freeOpen(best: Readonly<Record<string, Best>>, db: Db = DB): boolean {
  return weekPlayed(best, firstWeek(db), db);
}
