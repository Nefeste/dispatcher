// Слова разбора (игра владельца 20.11.2026, #22: «непонятно что недоспросил и почему надо было неотложку»): у каждой
// ошибки — «почему» под ней; экстренная без угрозы называет первые слова звонящего и его ответы на вопросы об угрозе;
// строка «по услышанному» объясняет, почему форма такая. Смены играет бот «спросил по правилам, решил всё экстренно».
import { expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { shiftCtx } from '../../src/engine/shift';
import { T } from '../../src/i18n';
import { loadMap } from '../../src/map/load';
import { mistakeText, mistakeWhy } from '../../src/screens/reviewWords';
import { reviewView } from '../../src/state/reviewView';
import { BOTS, play } from '../sim/bots';

const ctx = shiftCtx(DB, MED, 'shift.proto', loadMap(DB.cities['city.proto'].map));

test('у каждого вида ошибки — «почему»', () => {
  for (const kind of ['noDispatch', 'underTriage', 'missedQuestion', 'order', 'hospital', 'crew'] as const) {
    expect(T.review.why[kind]().length).toBeGreaterThan(20);
  }
  expect(T.review.why.overTriage([]).length).toBeGreaterThan(20);
});

test('экстренная без угрозы: первые слова, ответы на вопросы об угрозе и «по услышанному»', () => {
  const bot = { ...BOTS.rules, form: 'emergency' as const };
  let found = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const v = reviewView(ctx, play(ctx, seed, bot).s);
    for (const r of v.rows) {
      const d = v.detail(r.id)!;
      for (const m of d.mistakes.filter(x => x.m.kind === 'overTriage')) {
        found++;
        expect(mistakeText(m)).toContain(`«${m.said}»`);
        // бот спросил о сознании и дыхании до решения — ответы звонящего видны в «почему» и в «по услышанному»
        expect(m.cleared!.length).toBeGreaterThan(0);
        for (const c of m.cleared!) expect(mistakeWhy(m)).toContain(c);
        expect(d.threats).toEqual([]);
        expect(T.review.knownWhy(d.threats, d.cleared)).toContain(d.cleared[0]);
      }
    }
  }
  expect(found).toBeGreaterThan(5);
});

test('признак угрозы прозвучал — «по услышанному» его называет', () => {
  let found = 0;
  for (let seed = 1; seed <= 3; seed++) {
    const v = reviewView(ctx, play(ctx, seed, BOTS.rules).s);
    for (const r of v.rows) {
      const d = v.detail(r.id)!;
      if (!d.threats.length) continue;
      found++;
      expect(d.known).toBe('emergency');
      expect(T.review.knownWhy(d.threats, d.cleared)).toContain(d.threats[0]);
    }
  }
  expect(found).toBeGreaterThan(3);
});
