// Итог смены (docs/08-game-design.md, §7, «Итог смены»): три числа — экстренные с доездом в норму и из скольких,
// сколько ждали неотложные по медиане, сколько вызовов приняли. Экстренный и неотложный — по правде (исход считает
// правда, ADR 0005); доезд — от поступления вызова до прибытия бригады, как в журнале вызовов (942).
import { formByTruth } from './form';
import { NORM_EMERGENCY } from './rules';
import type { Shift, ShiftCtx } from './shift';

export interface Totals {
  /** экстренных по правде и сколько из них — с доездом в норму */
  emergency: number;
  inNorm: number;
  /** неотложные: медиана от звонка до прибытия, мс; null — не было */
  urgentMedian: number | null;
  /** принято звонков — вызовов, по которым был разговор */
  accepted: number;
}

export function totals(ctx: ShiftCtx, s: Shift): Totals {
  let emergency = 0, inNorm = 0, accepted = 0;
  const urgent: number[] = [];
  for (const c of s.calls) {
    if (c.answeredAt === null) continue;
    accepted++;
    const wait = c.arrivedAt === null ? null : c.arrivedAt - c.ringAt;
    if (formByTruth(ctx.db, c.truth) === 'emergency') {
      emergency++;
      if (wait !== null && wait <= NORM_EMERGENCY) inNorm++;
    } else if (wait !== null) urgent.push(wait);
  }
  urgent.sort((a, b) => a - b);
  const urgentMedian = urgent.length ? urgent[Math.floor((urgent.length - 1) / 2)] : null;
  return { emergency, inNorm, urgentMedian, accepted };
}
