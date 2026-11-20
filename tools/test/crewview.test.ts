// Карточка бригады по касанию на карте (#26, вариант 1): касание у знака находит бригаду, карточка говорит, чем она
// занята, какой вызов и сколько ещё, — и только то, что знает пульт (ADR 0005: ни болезни, ни правды о больном).
import { expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { shiftCtx } from '../../src/engine/shift';
import { BENCH_SHIFT, benchShift, benchStep } from '../../src/state/bench';
import { loadMap } from '../../src/map/load';
import { crewAt, crewCard, crewPoint } from '../../src/state/crewView';
import { BOTS, play } from '../sim/bots';

const ctx = shiftCtx(DB, MED, 'shift.proto', loadMap(DB.cities['city.proto'].map));

test('касание у знака находит бригаду; вдали от всех — никого', () => {
  const { s } = play(ctx, 3, BOTS.rules);
  s.crews.forEach((c, i) => {
    const [x, y] = crewPoint(ctx, s, i);
    const got = crewAt(ctx, s, x + 3, y - 3, 50)!;
    // на подстанции знаки стоят в одной точке — находится одна из них
    const [gx, gy] = crewPoint(ctx, s, s.crews.findIndex(k => k.id === got));
    expect(Math.hypot(gx - x, gy - y)).toBeLessThan(10);
    expect(c.id).toBeTruthy();
  });
  expect(crewAt(ctx, s, -1e6, -1e6, 50)).toBeNull();
});

test('карточка посреди смены: вызов у занятых, сроки вперёд, без правды о больном', () => {
  // смена «Замера» с 70-й минуты: бригады на улицах; дальше её ведёт диспетчер «Замера» по пять минут
  const s = benchShift(ctx, BENCH_SHIFT.seed, BENCH_SHIFT.minute);
  const states = new Set<string>();
  let cards = 0;
  for (let t = 0; t < 12 && !s.over; t++) {
    for (const c of s.crews) {
      const card = crewCard(ctx, s, c.id)!;
      cards++;
      states.add(card.state);
      expect(Object.keys(card).sort()).toEqual(['call', 'hospital', 'id', 'kind', 'minutes', 'no', 'state']);
      if (card.state === 'base') expect(card.call).toBeNull();
      if (card.state === 'drive' || card.state === 'scene' || card.state === 'transport') expect(card.call).not.toBeNull();
      if (card.state === 'transport') expect(card.hospital).not.toBeNull();
      if (card.minutes !== null) expect(card.minutes).toBeGreaterThan(0);
    }
    benchStep(ctx, s, 5 * 60_000);
  }
  expect(cards).toBeGreaterThan(50);
  // за час смены бригады бывают едущими и на месте
  expect(states.has('drive') && states.has('scene')).toBe(true);
  expect(crewCard(ctx, s, 'нет такой')).toBeNull();
});
