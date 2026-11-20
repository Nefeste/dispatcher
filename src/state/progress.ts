// Лучший итог смены (спецификация прототипа, §5; docs/08-game-design.md, §7: «лучший итог смены хранится; серий и
// звёзд нет»). Лучше — больше экстренных в норму по доле, при равной — короче ожидание неотложных. Хранилище — ключ
// `progress` (docs/04-data-model.md, §3), без дат.
import type { Totals } from '../engine/totals';
import { KEYS, readRaw, writeRaw } from './storage';

export type Best = Pick<Totals, 'emergency' | 'inNorm' | 'urgentMedian' | 'accepted'>;

/** Лучше ли итог `a`, чем `b`. */
export function better(a: Best, b: Best | null): boolean {
  if (!b) return true;
  const share = (x: Best) => (x.emergency ? x.inNorm / x.emergency : 1);
  if (share(a) !== share(b)) return share(a) > share(b);
  return (a.urgentMedian ?? Infinity) < (b.urgentMedian ?? Infinity);
}

function parse(raw: string | null): Record<string, Best> {
  try {
    const x = raw ? (JSON.parse(raw) as { best?: Record<string, Best> }) : {};
    return x.best && typeof x.best === 'object' ? x.best : {};
  } catch {
    return {};
  }
}

/** Записать итог смены; вернуть прежний лучший (до этой смены) и новый ли рекорд. */
export async function recordBest(shift: string, t: Best): Promise<{ before: Best | null; isBest: boolean }> {
  const best = parse(await readRaw(KEYS.progress));
  const before = best[shift] ?? null;
  const isBest = better(t, before);
  if (isBest) {
    best[shift] = { emergency: t.emergency, inNorm: t.inNorm, urgentMedian: t.urgentMedian, accepted: t.accepted };
    await writeRaw(KEYS.progress, JSON.stringify({ best }));
  }
  return { before, isBest };
}

// итог одной смены записывается один раз: экран итога может открыться снова (из разбора вызова) или эффект — сработать
// дважды; повторная запись сравнила бы итог сам с собой
const recorded = new Map<string, Promise<{ before: Best | null; isBest: boolean }>>();

/** `recordBest` один раз на смену (`key` — смена и её зерно); повторно — тот же ответ. */
export function recordBestOnce(key: string, shift: string, t: Best): Promise<{ before: Best | null; isBest: boolean }> {
  let p = recorded.get(key);
  if (!p) {
    p = recordBest(shift, t);
    recorded.set(key, p);
  }
  return p;
}
