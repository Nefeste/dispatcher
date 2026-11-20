// Поток звонков (docs/02-architecture.md, §3; docs/08-game-design.md, §9): промежуток до следующего звонка по кривой
// часа content/flow.yaml — ровно от 0,3 до 1,7 среднего. Только + − × ÷: показательное распределение потребовало бы
// логарифма, а он в движке запрещён (ADR 0004 устава). Как arrivalAfter «Больницы».
import type { Flow } from '../content/types';
import type { Rng } from './core/rng';

/** Звонков в час в этот час суток. */
export function perHour(flow: Flow, secOfDay: number): number {
  const h = Math.floor(secOfDay / 3600) % 24;
  let n = flow.hours[0].perHour;
  for (const x of flow.hours) if (x.from <= h) n = x.perHour;
  return n;
}

/** Через сколько мс следующий звонок, если сейчас `secOfDay`; `pct` — поток смены в процентах от кривой. */
export function gapAfter(flow: Flow, secOfDay: number, rng: Rng, pct = 100): number {
  const mean = Math.floor((3_600_000 * 100) / (perHour(flow, secOfDay) * pct));
  return Math.floor((mean * (300 + rng.int(1401))) / 1000);
}
