// Разговор как по телефону (игра владельца 22.11.2026; docs/specs/2026-11-call-flow.md): перезвонить ждущему — когда
// можно, что стоит, решение после перезвона — новое решение в разборе; строка диспетчера над словами звонящего;
// поликлиника закрыта — вид это говорит; подсказка «может решить форму» — только по услышанному.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { formByKnown, mayDecide } from '../../src/engine/form';
import { SNAG_PHONE } from '../../src/engine/rules';
import { advance, apply, callOf, nextEvent, newShift, shiftCtx } from '../../src/engine/shift';
import type { Heard } from '../../src/engine/talk';
import { loadMap } from '../../src/map/load';
import { callView } from '../../src/state/callView';
import { weekShifts } from '../../src/state/week';

const map = loadMap(DB.cities['city.proto'].map);
const week = weekShifts();

describe('перезвонить ждущему', () => {
  test('ждущий вызов: перезвон открывает разговор, минута набора; форму можно назвать снова — новое решение', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    const s = newShift(ctx, 9);
    advance(ctx, s, nextEvent(ctx, s));
    expect(apply(ctx, s, { c: 'answer' })).toBeNull();
    const id = s.open!;
    // пока разговор открыт и пока не решили — перезвонить нельзя
    expect(apply(ctx, s, { c: 'dial', call: id })).toBe('talking');
    expect(apply(ctx, s, { c: 'form', form: 'urgent' })).toBeNull();
    expect(apply(ctx, s, { c: 'hold', call: id })).toBeNull();
    expect(callOf(s, id)!.state).toBe('wait');
    // звонит телефон — линия одна
    if (s.rings.length) expect(apply(ctx, s, { c: 'dial', call: id })).toBe('ringing');
    while (s.rings.length) {
      apply(ctx, s, { c: 'answer' });
      apply(ctx, s, { c: 'form', form: 'urgent' });
      apply(ctx, s, { c: 'hold', call: s.open! });
    }
    const t = s.t;
    expect(apply(ctx, s, { c: 'dial', call: id })).toBeNull();
    const call = callOf(s, id)!;
    expect(s.open).toBe(id);
    expect(call.state).toBe('talk');
    expect(call.dialedAt).toBe(t);
    expect(s.t).toBeGreaterThanOrEqual(t + SNAG_PHONE);
    const v = callView(ctx, s, id)!;
    expect(v.dialed).toBe(true);
    expect(v.me).toEqual({ kind: 'dial' });
    expect(v.form).toBe('urgent');
    // спросили — строка диспетчера — этот вопрос
    const q = v.groups.flatMap(g => g.questions).find(x => !x.asked)!;
    expect(apply(ctx, s, { c: 'ask', q: q.id })).toBeNull();
    const v2 = callView(ctx, s, id)!;
    expect(v2.dialed).toBe(false);
    expect(v2.me).toEqual({ kind: 'asked', text: DB.phone.questions[q.id].text });
    const before = call.decisions.length;
    expect(apply(ctx, s, { c: 'form', form: 'emergency' })).toBeNull();
    expect(call.decisions.length).toBe(before + 1);
    expect(call.decisions.at(-1)!.form).toBe('emergency');
    // перезванивать можно только ждущему
    expect(apply(ctx, s, { c: 'hold', call: id })).toBeNull();
    const other = s.calls.find(c => c.state !== 'wait')!;
    if (other) expect(apply(ctx, s, { c: 'dial', call: other.id })).toBe('notWaiting');
  });

  test('принятый звонок: строка диспетчера — «Скорая, слушаю»', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    const s = newShift(ctx, 11);
    advance(ctx, s, nextEvent(ctx, s));
    apply(ctx, s, { c: 'answer' });
    const v = callView(ctx, s, s.open!)!;
    expect(v.me).toEqual({ kind: 'answer' });
    expect(v.dialed).toBe(false);
  });

  test('поликлиника закрыта (ночная смена с поликлиникой): неотложный — «закрыта», врача на дом нет', () => {
    const night = shiftCtx(DB, MED, week[3].id, map);
    expect(night.setup.clinic).toBe(true);
    const n = newShift(night, 4);
    advance(night, n, nextEvent(night, n));
    apply(night, n, { c: 'answer' });
    apply(night, n, { c: 'form', form: 'urgent' });
    const v = callView(night, n, n.open!)!;
    expect(v.pass).toBe(false);
    expect(v.passClosed).toBe(true);
    expect(v.clinicHours).toEqual([8, 20]);
    expect(v.clinicMin).toEqual([40, 120]);
  });
});

describe('подсказка «может решить форму»', () => {
  test('только по услышанному: вопросы, что открывают угрозу при этом поводе; угроза прозвучала — подсказки нет', () => {
    // признак без угрозы, у болезни которого есть признаки угрозы: о нём сказали «да»
    const calm = Object.values(DB.phone.findings).find(f => !f.threat && Object.keys(DB.phone.conditions).some(c =>
      MED.conditions[c]?.findings.some(l => l.f === f.id) && MED.conditions[c].findings.some(l => DB.phone.findings[l.f]?.threat)))!.id;
    const chest = new Map<string, Heard>([[calm, 'yes']]);
    const hints = mayDecide(DB, MED, chest, new Set());
    expect(hints.size).toBeGreaterThan(0);
    // каждый подсказанный вопрос открывает признак угрозы
    for (const q of hints) expect(DB.phone.questions[q].opens.some(f => DB.phone.findings[f]?.threat)).toBe(true);
    // заданный вопрос не подсказывается
    const first = [...hints][0];
    expect(mayDecide(DB, MED, chest, new Set([first])).has(first)).toBe(false);
    // угроза уже прозвучала — форма решена
    const threat = Object.values(DB.phone.findings).find(f => f.threat)!.id;
    const decided = new Map<string, Heard>([...chest, [threat, 'yes']]);
    expect(formByKnown(DB, decided)).toBe('emergency');
    expect(mayDecide(DB, MED, decided, new Set()).size).toBe(0);
  });

  test('вид вызова отмечает вопросы и не читает правду: у двух вызовов с тем же услышанным — те же подсказки', () => {
    const ctx = shiftCtx(DB, MED, week[1].id, map);
    for (const seed of [3, 5, 8]) {
      const s = newShift(ctx, seed);
      advance(ctx, s, nextEvent(ctx, s));
      apply(ctx, s, { c: 'answer' });
      const call = callOf(s, s.open!)!;
      const v = callView(ctx, s, call.id)!;
      const fromView = new Set(v.groups.flatMap(g => g.questions).filter(q => q.hint).map(q => q.id));
      expect(fromView).toEqual(mayDecide(DB, MED, new Map(Object.entries(call.heard)), new Set(call.asked.map(a => a.q))));
    }
  });
});
