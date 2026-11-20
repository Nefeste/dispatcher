// Исход и последствия (срез, часть С3; docs/08-game-design.md, §7): смерть до приезда бригады — только по записи
// `fatal` с источником; отказ в выезде, когда повод был, — повторный звонок в ту же смену; служебная проверка за смерть
// при решении против услышанного; тяжёлая ошибка доходит письмом до ввода следующей смены (спецификация среза, §4,
// «последствие доходит»).
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import type { Db } from '../../src/content/types';
import { formByTruth } from '../../src/engine/form';
import { FAR } from '../../src/engine/road/route';
import { review } from '../../src/engine/review';
import { CALLBACK, CALLBACK_SOON, NORM_EMERGENCY, NORM_URGENT } from '../../src/engine/rules';
import { advance, apply, callOf, nextEvent, newShift, type Shift, type ShiftCtx, shiftCtx } from '../../src/engine/shift';
import { afterShift, newStation, reportOf } from '../../src/engine/station';
import { loadMap } from '../../src/map/load';
import { callView } from '../../src/state/callView';
import { introNote } from '../../src/state/stationView';
import { weekShifts } from '../../src/state/week';
import { BOTS, botMove, play } from '../sim/bots';

const map = loadMap(DB.cities['city.proto'].map);
const week = weekShifts();

/** База, где каждое состояние убивает при любом опоздании, — чтобы проверить механику, не числа записей. */
function deadly(db: Db): Db {
  const conditions = Object.fromEntries(Object.entries(db.phone.conditions).map(([id, c]) => [id, { ...c, fatal: { late: 0, chance: 10_000, source: c.sources[0] } }]));
  return { ...db, phone: { ...db.phone, conditions } };
}

/** Доиграть смену ботом. */
function finish(ctx: ShiftCtx, s: Shift): void {
  for (let i = 0; i < 20000 && !s.over; i++) {
    const cmd = botMove(ctx, s, BOTS.rules);
    if (cmd) expect(apply(ctx, s, cmd)).toBeNull();
    else {
      const next = nextEvent(ctx, s);
      advance(ctx, s, next === FAR ? 60_000 : Math.max(1, next - s.t));
    }
  }
  expect(s.over).toBe(true);
}

describe('исход и последствия', () => {
  test('без записи `fatal` никто не умирает: смерть — только по источнику', () => {
    const fatal = Object.values(DB.phone.conditions).filter(c => c.fatal);
    for (const c of fatal) {
      expect(c.sources).toContain(c.fatal!.source);
      expect(c.estimate).toBe(true);
    }
    const ctx = shiftCtx(DB, MED, week[5].id, map);
    for (const seed of [1, 2, 3]) {
      const { s } = play(ctx, seed, BOTS.noQuestions);
      for (const c of s.calls) if (c.died) expect(DB.phone.conditions[c.truth.condition].fatal).toBeDefined();
    }
  });

  test('приехали позже, чем позволяет запись, — смерть до приезда: не везут, исход третьей ступени, рация говорит', () => {
    const ctx = shiftCtx(deadly(DB), MED, week[1].id, map);
    const { s } = play(ctx, 4, BOTS.rules);
    const dead = s.calls.filter(c => c.died);
    expect(dead.length).toBeGreaterThan(0);
    for (const c of dead) {
      expect(c.transport).toBe(false);
      expect(c.hospital).toBeNull();
      const norm = formByTruth(ctx.db, c.truth) === 'emergency' ? NORM_EMERGENCY : NORM_URGENT;
      expect(c.arrivedAt! - c.ringAt).toBeGreaterThan(norm);
    }
    const r = review(ctx, s);
    for (const c of r.calls) expect(c.outcome.tier === 'died').toBe(s.calls.find(x => x.id === c.id)!.died);
    expect(reportOf(ctx, s).deaths).toBe(dead.length);
  });

  test('отказ в выезде, когда повод был: позвонят снова в эту смену, своими словами; решение можно поменять', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    const s = newShift(ctx, 9);
    advance(ctx, s, nextEvent(ctx, s));
    expect(apply(ctx, s, { c: 'answer' })).toBeNull();
    const id = s.open!;
    expect(formByTruth(ctx.db, callOf(s, id)!.truth)).not.toBe('none');
    expect(apply(ctx, s, { c: 'form', form: 'none' })).toBeNull();
    const call = callOf(s, id)!;
    const at = s.t;
    expect(call.callbackAt).not.toBeNull();
    expect(call.callbackAt!).toBeGreaterThanOrEqual(Math.min(at + CALLBACK[0], at + CALLBACK_SOON));
    expect(call.callbackAt!).toBeLessThanOrEqual(Math.max(at + CALLBACK_SOON, ctx.setup.length * 1000));
    // до звонка — смена не кончается, звонок приходит в своё время повторным
    for (let i = 0; i < 20000 && s.rings.every(r => r.call !== id); i++) {
      const cmd = botMove(ctx, s, BOTS.rules);
      if (cmd && !(cmd.c === 'answer' && s.rings[0]?.call === id)) expect(apply(ctx, s, cmd)).toBeNull();
      else advance(ctx, s, Math.max(1, nextEvent(ctx, s) - s.t));
      expect(s.over).toBe(false);
    }
    const ring = s.rings.find(r => r.call === id)!;
    expect([ring.repeat, ring.refused]).toEqual([true, true]);
    expect(ring.at).toBe(call.callbackAt === null ? ring.at : call.callbackAt);
    while (s.open) apply(ctx, s, botMove(ctx, s, BOTS.rules)!);
    expect(apply(ctx, s, { c: 'answer', ring: ring.id })).toBeNull();
    const said = callView(ctx, s, id)!.said;
    const kind = ctx.db.phone.callers[call.truth.caller];
    expect(kind.refused.some(t => said.startsWith(t.split('{')[0].trim().slice(0, 8)))).toBe(true);
    finish(ctx, s);
    const r = review(ctx, s).calls.find(c => c.id === id)!;
    expect(r.decided).toBe('none');
    expect(r.mistakes.map(m => m.m.kind)).toContain('noDispatch');
    expect(callOf(s, id)!.arrivedAt).not.toBeNull();
  });

  test('смерть при решении против услышанного — служебная проверка; письмо доходит до ввода следующей смены, и только её', () => {
    const ctx = shiftCtx(deadly(DB), MED, week[1].id, map);
    const { s } = play(ctx, 6, BOTS.allEmergency);
    // всё экстренно — против услышанного не решали: смерти есть, проверок нет
    const calm = reportOf(ctx, s);
    expect(calm.deaths).toBeGreaterThan(0);
    expect(calm.inquiries).toEqual([]);
    // отказ в выезде, когда повод был, — тяжёлая ошибка: письмо на ввод следующей смены
    const st = afterShift(newStation(), { ...calm, refusals: 1, inquiries: [7] });
    expect(st.fund).toBe(afterShift(newStation(), calm).fund - 15_000 - 50_000);
    expect(st.journal.filter(e => e.kind === 'inquiry')).toHaveLength(1);
    expect(introNote(st, week[2].id)).toEqual({ n: 2, inquiries: [7], refusals: 1 });
    expect(introNote(st, week[3].id)).toBeNull();
    expect(introNote(afterShift(newStation(), calm), week[2].id)).toBeNull();
  });
});
