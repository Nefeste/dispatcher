// Смена (часть П5; docs/08-game-design.md, §2–§5; ADR 0003): «бот-диспетчер» проходит смену от начала до конца —
// принимает звонки, спрашивает, решает по услышанному, шлёт ближайшую бригаду, отвечает на доклады. Смена кончается,
// каждый вызов доведён до конца, отметки времени идут по порядку; та же смена с теми же командами — тот же итог, а
// переигранная из сохранения — та же самая.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { fingerprint } from '../../src/engine/core/hash';
import { free } from '../../src/engine/crews';
import { formByKnown } from '../../src/engine/form';
import { FAR } from '../../src/engine/road/route';
import { ANSWER, DECIDE } from '../../src/engine/rules';
import { advance, apply, callOf, type Command, crewOptions, type Logged, newShift, nextEvent, replay, type Shift, type ShiftCtx, shiftCtx } from '../../src/engine/shift';
import { loadMap } from '../../src/map/load';

const ctx: ShiftCtx = shiftCtx(DB, MED, 'shift.proto', loadMap(DB.cities['city.proto'].map));
const QS = ['q.conscious', 'q.breathing', 'q.face', 'q.pain_where', 'q.skin'];

/** Бот: что сделал бы диспетчер «по правилам» сейчас; null — ждать. */
function botMove(s: Shift): Command | null {
  if (s.open) {
    const call = callOf(s, s.open)!;
    const next = QS.find(q => !call.asked.some(a => a.q === q));
    if (call.form === null && next) return { c: 'ask', q: next };
    if (call.form === null) return { c: 'form', form: formByKnown(DB, new Map(Object.entries(call.heard))) };
    const opt = crewOptions(ctx, s, call.id)[0];
    return opt ? { c: 'send', call: call.id, crew: opt.crew } : { c: 'hold', call: call.id };
  }
  if (s.rings.length) return { c: 'answer' };
  const report = s.calls.find(c => c.state === 'report');
  if (report) return { c: 'hospital', call: report.id, hospital: report.suggested! };
  // ждущие — сначала экстренные, потом по времени
  const waiting = s.calls.filter(c => c.state === 'wait').sort((a, b) => (a.form === b.form ? a.ringAt - b.ringAt : a.form === 'emergency' ? -1 : 1));
  for (const w of waiting) {
    const opt = crewOptions(ctx, s, w.id).find(o => !o.redirect);
    if (opt) return { c: 'send', call: w.id, crew: opt.crew };
  }
  return null;
}

function play(seed: number): { s: Shift; log: Logged[] } {
  const s = newShift(ctx, seed);
  const log: Logged[] = [];
  for (let i = 0; i < 5000 && !s.over; i++) {
    const cmd = botMove(s);
    if (cmd) {
      const t = s.t;
      expect(apply(ctx, s, cmd), JSON.stringify(cmd)).toBeNull();
      log.push({ t, cmd });
    } else {
      const next = nextEvent(ctx, s);
      advance(ctx, s, next === FAR ? 60_000 : Math.max(1, next - s.t));
    }
  }
  return { s, log };
}

describe('смена', () => {
  const runs = [1, 2, 3].map(seed => ({ seed, ...play(seed) }));

  test('смена проходится до конца; каждый вызов доведён; отметки времени — по порядку', () => {
    for (const { s } of runs) {
      expect(s.over).toBe(true);
      expect(s.calls.length).toBeGreaterThanOrEqual(15);
      expect(s.calls.length).toBeLessThanOrEqual(35);
      expect(s.t).toBeGreaterThanOrEqual(ctx.setup.length * 1000);
      for (const c of s.calls) {
        expect(c.state).toBe('done');
        const order = [c.ringAt, c.answeredAt, c.decidedAt, c.sentAt, c.arrivedAt, c.reportAt, c.transportAt, c.hospitalAt, c.doneAt].filter((x): x is number => x !== null);
        for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThanOrEqual(order[i - 1]);
        if (c.form !== 'none') expect(c.arrivedAt).not.toBeNull();
        if (c.hospital) expect(c.transport).toBe(true);
      }
      for (const c of s.crews) expect(free(c)).toBe(true);
    }
  });

  test('учебные звонки — первыми, как в записи смены', () => {
    const { s } = runs[0];
    ctx.setup.script.forEach((r, i) => {
      const c = s.calls[i];
      expect(c.ringAt).toBe(r.at * 1000);
      expect(c.truth.condition).toBe(r.condition);
      expect(c.truth.caller).toBe(r.caller);
      // учебный случай — без редкостей: у экстренной болезни есть свой признак угрозы
      const own = c.truth.patient.truth.findings.filter(x => x.cause === r.condition && DB.phone.findings[x.f]);
      expect(own.length).toBeGreaterThan(0);
      if (DB.phone.conditions[r.condition].form === 'emergency') expect(own.some(x => DB.phone.findings[x.f].threat)).toBe(true);
    });
  });

  test('часы разговора: принять — 30 с, вопрос — его цена, решение — 10 с; пока открыт, часы стоят', () => {
    const s = newShift(ctx, 7);
    advance(ctx, s, ctx.setup.script[0].at * 1000);
    expect(s.rings.length).toBe(1);
    const t0 = s.t;
    expect(apply(ctx, s, { c: 'answer' })).toBeNull();
    expect(s.t).toBe(t0 + ANSWER);
    advance(ctx, s, 600_000);
    expect(s.t).toBe(t0 + ANSWER);
    apply(ctx, s, { c: 'ask', q: 'q.breathing' });
    expect(s.t).toBe(t0 + ANSWER + DB.phone.questions['q.breathing'].cost * 1000);
    const t1 = s.t;
    apply(ctx, s, { c: 'ask', q: 'q.breathing' });
    expect(s.t).toBe(t1 + 10_000);
    const t2 = s.t;
    apply(ctx, s, { c: 'form', form: 'emergency' });
    expect(s.t).toBe(t2 + DECIDE);
    expect(apply(ctx, s, { c: 'answer' })).toBe('talking');
    const opt = crewOptions(ctx, s, s.open!)[0];
    expect(apply(ctx, s, { c: 'send', call: s.open!, crew: opt.crew })).toBeNull();
    expect(s.open).toBeNull();
  });

  test('отказы: нет звонка, нет разговора, нет формы, бригада занята', () => {
    const s = newShift(ctx, 9);
    expect(apply(ctx, s, { c: 'answer' })).toBe('noRing');
    expect(apply(ctx, s, { c: 'ask', q: 'q.age' })).toBe('notOpen');
    advance(ctx, s, ctx.setup.script[0].at * 1000);
    apply(ctx, s, { c: 'answer' });
    const id = s.open!;
    expect(apply(ctx, s, { c: 'send', call: id, crew: 'crew.1' })).toBe('noForm');
    apply(ctx, s, { c: 'form', form: 'urgent' });
    apply(ctx, s, { c: 'send', call: id, crew: 'crew.1' });
    // вторая бригада — на тот же вызов нельзя: он уже с бригадой
    expect(apply(ctx, s, { c: 'send', call: id, crew: 'crew.2' })).toBe('unknown');
  });

  test('экстренный снимает бригаду с неотложного; тот снова ждёт', () => {
    const s = newShift(ctx, 11);
    advance(ctx, s, ctx.setup.script[0].at * 1000);
    apply(ctx, s, { c: 'answer' });
    const a = s.open!;
    apply(ctx, s, { c: 'form', form: 'urgent' });
    apply(ctx, s, { c: 'send', call: a, crew: 'crew.1' });
    advance(ctx, s, ctx.setup.script[1].at * 1000 - s.t);
    apply(ctx, s, { c: 'answer' });
    const b = s.open!;
    apply(ctx, s, { c: 'form', form: 'emergency' });
    const opts = crewOptions(ctx, s, b);
    expect(opts.some(o => o.crew === 'crew.1' && o.redirect)).toBe(callOf(s, a)!.state === 'sent');
    if (callOf(s, a)!.state === 'sent') {
      expect(apply(ctx, s, { c: 'send', call: b, crew: 'crew.1' })).toBeNull();
      expect(callOf(s, a)!.state).toBe('wait');
      expect(callOf(s, a)!.recalled).toEqual(['crew.1']);
      expect(callOf(s, b)!.crew).toBe('crew.1');
    }
  });

  // отпечаток смены без счётчика перерисовок: он считает шаги часов, а не то, что случилось
  const print = (s: Shift) => fingerprint({ ...s, rev: 0 });

  test('та же смена с теми же командами — тот же итог; из сохранения — та же самая', () => {
    for (const { seed, s, log } of runs) {
      expect(print(play(seed).s)).toBe(print(s));
      const again = replay(ctx, seed, log);
      advance(ctx, again, s.t - again.t);
      expect(print(again)).toBe(print(s));
    }
    expect(print(runs[0].s)).not.toBe(print(runs[1].s));
  });
});
