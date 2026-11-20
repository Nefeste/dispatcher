// Исход и разбор (часть П6; docs/08-game-design.md, §7; ADR 0005): по известному и по правде — отдельно. Бот «по
// правилам» не решает против услышанного и не нарушает порядок; бот «без вопросов» получает «не спросили», где
// звонящий знал ответ; невезение ошибкой не считается; не та больница — перевод с ценой в минутах; главная ошибка —
// самая дорогая.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { formByKnown, formByTruth } from '../../src/engine/form';
import { heardAt, review, reviewCall } from '../../src/engine/review';
import { shiftCtx } from '../../src/engine/shift';
import { ask } from '../../src/engine/talk';
import { loadMap } from '../../src/map/load';
import { BOTS, play } from '../sim/bots';

const ctx = shiftCtx(DB, MED, 'shift.proto', loadMap(DB.cities['city.proto'].map));
const SEEDS = [1, 2, 3, 4];

describe('разбор', () => {
  const rules = SEEDS.map(seed => play(ctx, seed, BOTS.rules).s);
  const blind = SEEDS.map(seed => play(ctx, seed, BOTS.noQuestions).s);

  test('что было известно в минуту решения — то же, что записано в решении', () => {
    for (const s of [...rules, ...blind]) {
      for (const c of s.calls) {
        for (const d of c.decisions) expect(formByKnown(DB, heardAt(c, d.t + 1))).toBe(d.known);
      }
    }
  });

  test('«по правилам»: не против услышанного, не против порядка, не та больница — никогда', () => {
    for (const s of rules) {
      for (const c of review(ctx, s).calls) {
        const kinds = c.mistakes.map(m => m.m.kind);
        expect(kinds).not.toContain('underTriage');
        expect(kinds).not.toContain('order');
        expect(kinds).not.toContain('hospital');
        expect(kinds).not.toContain('noDispatch');
        expect(kinds).not.toContain('crew');
      }
    }
  });

  test('«без вопросов»: «не спросили» — только там, где вопрос открыл бы угрозу; иначе — невезение', () => {
    let missed = 0, unlucky = 0;
    for (const s of blind) {
      for (const r of review(ctx, s).calls) {
        const call = s.calls.find(c => c.id === r.id)!;
        const m = r.mistakes.map(x => x.m).find(x => x.kind === 'missedQuestion');
        if (m && m.kind === 'missedQuestion') {
          const { q, f } = m;
          missed++;
          expect(formByTruth(DB, call.truth)).toBe('emergency');
          const a = ask(DB, MED, call.truth, q, heardAt(call, call.decisions[0].t), 0);
          expect(a.learned.some(l => l.f === f && l.heard === 'yes')).toBe(true);
          expect(DB.phone.findings[f].threat).toBeTruthy();
        }
        if (r.unlucky) {
          unlucky++;
          expect(r.mistakes).toEqual([]);
          expect(r.outcome.form).toBe('emergency');
        }
      }
    }
    expect(missed).toBeGreaterThan(0);
    expect(unlucky).toBeGreaterThanOrEqual(0);
  });

  test('не та больница — перевод: ошибка с ценой в минутах, окно считается с переводом', () => {
    const s = play(ctx, 5, { ...BOTS.rules, hospital: 'last' }).s;
    const reviews = review(ctx, s).calls;
    const wrong = reviews.filter(r => r.outcome.hospital && !r.outcome.hospital.ok);
    expect(wrong.length).toBeGreaterThan(0);
    for (const r of wrong) {
      const m = r.mistakes.find(x => x.m.kind === 'hospital');
      expect(m).toBeDefined();
      expect(m!.cost).toBeGreaterThan(0);
    }
  });

  test('всё экстренно: лишняя экстренная — ошибка без цены; главная ошибка — самая дорогая', () => {
    const s = play(ctx, 6, BOTS.allEmergency).s;
    const r = review(ctx, s);
    expect(r.calls.some(c => c.mistakes.some(m => m.m.kind === 'overTriage' && m.cost === 0))).toBe(true);
    for (const run of [...blind, s]) {
      const rv = review(ctx, run);
      if (!rv.main) continue;
      const best = rv.calls.find(c => c.id === rv.main!.call)!.mistakes[rv.main.mistake].cost;
      for (const c of rv.calls) for (const m of c.mistakes) expect(m.cost).toBeLessThanOrEqual(best);
    }
  });

  test('без выезда, когда помощь была нужна, — ошибка; исход по правде — отдельно от решения', () => {
    const s = play(ctx, 7, { ...BOTS.noQuestions, name: 'без выезда', form: 'urgent' }).s;
    const call = s.calls[0];
    call.decisions[0] = { ...call.decisions[0], form: 'none' };
    const r = reviewCall(ctx, s, call);
    expect(r.mistakes[0].m.kind).toBe('noDispatch');
    expect(r.mistakes[0].cost).toBeGreaterThan(0);
    expect(r.outcome.form).toBe(formByTruth(DB, call.truth));
  });
});
