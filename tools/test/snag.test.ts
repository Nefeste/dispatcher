// Просьбы бригады на месте не про медицину (срез, С4, вторая половина; решение владельца #34, вариант 2;
// docs/08-game-design.md, §5, §9): не можем попасть в подъезд — только дома и только если «Подъезд, этаж, код?» не
// спросили; адрес не тот — верный рядом; на месте второй пострадавший — ещё бригада или одна, но дольше. Ответ — одним
// касанием; не ответили — бригада ждёт, ищет, справляется сама. Таких просьб — не больше одной на три вызова.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { FAR } from '../../src/engine/road/route';
import { review } from '../../src/engine/review';
import { ASK_AFTER, ASK_WAIT, SNAG_PHONE } from '../../src/engine/rules';
import { ACCESS, advance, apply, asking, type Command, crewOptions, nextEvent, newShift, type Shift, type ShiftCtx, shiftCtx, type SnagKind } from '../../src/engine/shift';
import { loadMap } from '../../src/map/load';
import { pultView } from '../../src/state/pultView';
import { weekShifts } from '../../src/state/week';
import { BOTS, botMove, play } from '../sim/bots';

const map = loadMap(DB.cities['city.proto'].map);
const week = weekShifts();

type Policy = 'phone' | 'wait' | 'none' | 'send';

/** Играть ботом «по правилам», но каждому вызову потока — эта просьба, а ответ на неё — по `policy`. */
function playWith(ctx: ShiftCtx, seed: number, kind: SnagKind, policy: Policy, questions: 'rules' | 'noQuestions' = 'noQuestions'): Shift {
  const s = newShift(ctx, seed);
  for (let i = 0; i < 40000 && !s.over; i++) {
    for (const c of s.calls) if (c.state === 'ring' && s.calls.indexOf(c) >= ctx.setup.script.length) c.plan = kind;
    const ask = s.calls.find(c => asking(c) !== null && asking(c) !== 'resus');
    let cmd: Command | null;
    if (ask && policy === 'none') cmd = s.open || s.rings.length ? botMove(ctx, s, BOTS[questions]) : null;
    else if (ask && policy === 'send') {
      const opt = crewOptions(ctx, s, ask.id).find(o => !o.redirect);
      cmd = opt ? { c: 'snag', call: ask.id, act: 'send', crew: opt.crew } : { c: 'snag', call: ask.id, act: 'wait' };
    } else if (ask) cmd = { c: 'snag', call: ask.id, act: policy === 'phone' && ask.snag!.kind !== 'victim' ? 'phone' : 'wait' };
    else cmd = botMove(ctx, s, BOTS[questions]);
    if (cmd) expect(apply(ctx, s, cmd)).toBeNull();
    else {
      const next = nextEvent(ctx, s);
      advance(ctx, s, next === FAR ? 60_000 : Math.max(1, next - s.t));
    }
  }
  expect(s.over).toBe(true);
  return s;
}

describe('просьбы бригады на месте', () => {
  test('не больше одной на три вызова: и у «по правилам», и у «без вопросов»; у учебных звонков — нет', () => {
    for (const bot of ['rules', 'noQuestions'] as const) {
      let calls = 0, asks = 0;
      for (const sh of week) {
        const ctx = shiftCtx(DB, MED, sh.id, map);
        for (const seed of [1, 2, 3]) {
          const { s } = play(ctx, seed, BOTS[bot]);
          for (const c of s.calls) {
            if (c.arrivedAt === null) continue;
            calls++;
            asks += Number(Boolean(c.snag)) + Number(Boolean(c.second));
            expect(Boolean(c.snag && c.second)).toBe(false);
          }
          for (const c of s.calls.slice(0, ctx.setup.script.length)) expect(c.plan).toBeNull();
        }
      }
      expect(asks / calls).toBeLessThanOrEqual(1 / 3);
      expect(asks).toBeGreaterThan(0);
    }
  });

  test('подъезд: только дома и когда «как пройти» не спросили; перезвонили — вошли через минуту, ждали — позже', () => {
    const ctx = shiftCtx(DB, MED, week[2].id, map);
    const asked = playWith(ctx, 4, 'door', 'phone', 'rules');
    expect(asked.calls.some(c => c.snag)).toBe(false);
    const phone = playWith(ctx, 4, 'door', 'phone');
    const wait = playWith(ctx, 4, 'door', 'wait');
    for (const s of [phone, wait]) {
      const doors = s.calls.filter(c => c.snag);
      expect(doors.length).toBeGreaterThan(0);
      for (const c of doors) {
        expect(c.truth.where).toBe('home');
        expect(c.asked.some(a => a.q === ACCESS)).toBe(false);
        const g = c.snag!;
        expect(g.at).toBe(c.arrivedAt!);
        expect(c.inAt).toBe(g.done!);
        if (g.answer === 'phone') expect(g.done).toBe(g.answeredAt! + SNAG_PHONE);
        else expect(g.done).toBe(Math.max(g.answeredAt!, g.at + g.wait));
      }
    }
    // на улице подъезда нет
    for (const c of phone.calls) if (c.truth.where === 'street') expect(c.snag).toBeNull();
    // разбор: у экстренного — ошибка «у подъезда», цена — минуты у двери
    const r = review(ctx, wait);
    for (const c of wait.calls.filter(x => x.snag && x.form === 'emergency')) {
      const m = r.calls.find(x => x.id === c.id)!.mistakes.find(x => x.m.kind === 'door')!;
      expect(m.m).toEqual({ kind: 'door', waited: true });
      expect(m.cost).toBe(Math.ceil((c.snag!.done! - c.snag!.at) / 60_000));
    }
  });

  test('адрес не тот: верный — другой узел рядом; бригада едет туда, приезд — к верному; уточнили — раньше', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    for (const policy of ['phone', 'none'] as const) {
      const s = playWith(ctx, 5, 'address', policy);
      const moved = s.calls.filter(c => c.snag);
      expect(moved.length).toBeGreaterThan(0);
      for (const c of moved) {
        const g = c.snag!;
        expect(c.node).toBe(g.node!);
        expect(c.arrivedAt!).toBeGreaterThan(g.at);
        expect(c.inAt).toBe(c.arrivedAt);
        if (policy === 'phone') expect(g.answer).toBe('phone');
        else {
          // не ответили: срок идёт с минуты, когда диспетчер свободен; адрес нашли сами — через своё время от просьбы
          expect(g.answer).toBe('auto');
          expect(g.answeredAt).toBeLessThanOrEqual(g.at + g.wait);
          expect(g.done).toBe(Math.max(g.answeredAt!, g.at + g.wait));
        }
      }
      const r = review(ctx, s);
      for (const c of moved.filter(x => x.form === 'emergency')) expect(r.calls.find(x => x.id === c.id)!.mistakes.some(m => m.m.kind === 'address')).toBe(policy === 'none' && !c.snag!.busy);
    }
  });

  test('второй пострадавший: послали — вторая приезжает, работает и свободна; одна — дольше на месте', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    const sent = playWith(ctx, 6, 'victim', 'send');
    const two = sent.calls.filter(c => c.snag?.answer === 'send');
    expect(two.length).toBeGreaterThan(0);
    for (const c of two) {
      const g = c.snag!;
      expect(g.at).toBe(c.inAt! + ASK_AFTER);
      expect(g.crew).not.toBe(c.crew);
      expect(sent.crews.find(x => x.id === g.crew)!.call).not.toBe(c.id);
      expect(sent.trail.some(t => t.crew === g.crew)).toBe(true);
    }
    const alone = playWith(ctx, 6, 'victim', 'wait');
    const one = alone.calls.filter(c => c.snag?.answer === 'wait');
    expect(one.length).toBeGreaterThan(0);
    // одна бригада: доклад позже ровно на `wait` — пока диспетчер решал, она работала, а не стояла
    for (const c of one) expect(c.reportAt! - c.inAt!).toBe(c.scene + c.snag!.wait);
    const r = review(ctx, alone);
    for (const c of one) {
      const has = r.calls.find(x => x.id === c.id)!.mistakes.some(m => m.m.kind === 'alone');
      expect(has).toBe(c.form === 'emergency' && c.snag!.free);
    }
  });

  test('вторую бригаду на помощь не разворачивают на другой вызов; пульт не видит, какая просьба будет', () => {
    const ctx = shiftCtx(DB, MED, week[4].id, map);
    const s = newShift(ctx, 8);
    for (let i = 0; i < 40000 && !s.over; i++) {
      for (const c of s.calls) if (c.state === 'ring' && s.calls.indexOf(c) >= ctx.setup.script.length) c.plan = 'victim';
      // едут на помощь чужому вызову: бригада вызова — другая
      const helpers = new Set(s.crews.filter(cr => cr.state === 'drive' && cr.call && s.calls.find(x => x.id === cr.call)?.crew !== cr.id).map(cr => cr.id));
      for (const c of s.calls) if (c.state === 'wait' || c.state === 'talk') for (const o of crewOptions(ctx, s, c.id)) if (o.redirect) expect(helpers.has(o.crew)).toBe(false);
      const ask = s.calls.find(c => asking(c) === 'victim');
      const v = pultView(ctx, s);
      if (ask) {
        expect(v.ask?.kind).toBe('victim');
        const opt = crewOptions(ctx, s, ask.id).find(o => !o.redirect);
        expect(apply(ctx, s, opt ? { c: 'snag', call: ask.id, act: 'send', crew: opt.crew } : { c: 'snag', call: ask.id, act: 'wait' })).toBeNull();
        continue;
      }
      expect(JSON.stringify(v)).not.toContain('"plan"');
      const cmd = botMove(ctx, s, BOTS.rules);
      if (cmd) expect(apply(ctx, s, cmd)).toBeNull();
      else advance(ctx, s, Math.max(1, Math.min(nextEvent(ctx, s), s.t + 60_000) - s.t));
    }
    expect(s.over).toBe(true);
  });

  test('пока диспетчер на звонке, срок просьбы не идёт: окно он увидит, когда закроет разговор; подъезд откроют и сами', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    // диспетчер не отвечает на просьбы, а на звонки — отвечает: часть просьб приходит посреди разговора
    const s = playWith(ctx, 9, 'door', 'none');
    const doors = s.calls.filter(c => c.snag);
    expect(doors.length).toBeGreaterThan(0);
    for (const c of doors) {
      const g = c.snag!;
      expect(g.answer).toBe('auto');
      // срок: две минуты с минуты, когда диспетчер свободен, — или раньше, если открыли сами
      expect(g.answeredAt! - g.at).toBeLessThanOrEqual(g.wait);
      expect(g.done).toBe(g.at + g.wait > g.answeredAt! ? g.at + g.wait : g.answeredAt);
    }
    // хотя бы одна пришла посреди разговора и прождала его конец
    expect(doors.some(c => c.snag!.busy || c.snag!.answeredAt! - c.snag!.at > ASK_WAIT)).toBe(true);
  });

  test('ответ не на ту просьбу — отказ, смена не меняется', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    const s = newShift(ctx, 3);
    expect(apply(ctx, s, { c: 'snag', call: 'call.1', act: 'phone' })).toBe('unknown');
    advance(ctx, s, nextEvent(ctx, s));
    expect(apply(ctx, s, { c: 'snag', call: 'call.1', act: 'wait' })).toBe('notAsked');
  });
});
