// Неотложная помощь поликлиники (срез, С5; docs/08-game-design.md, §4; решение владельца #38): в смене с поликлиникой и в
// её часы неотложный вызов можно передать туда; её врач у больного не позже чем через 2 часа (543n). Угроза жизни —
// звонит врач поликлиники, вызов возвращается, и диспетчер решает заново; нужна больница — просит бригаду; иначе —
// поликлиника помогла сама. Второй раз тот же вызов не передают. Смена не ждёт вызовов, которые поликлиника закроет сама.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { formByTruth } from '../../src/engine/form';
import { FAR } from '../../src/engine/road/route';
import { CLINIC_ARRIVE } from '../../src/engine/rules';
import { advance, apply, clinicOpen, nextEvent, newShift, type Shift, type ShiftCtx, shiftCtx } from '../../src/engine/shift';
import { loadMap } from '../../src/map/load';
import { callView } from '../../src/state/callView';
import { weekShifts } from '../../src/state/week';
import { BOTS, botMove, play } from '../sim/bots';

const map = loadMap(DB.cities['city.proto'].map);
const week = weekShifts();

/** Доиграть смену ботом «по правилам»: он передаёт неотложные в поликлинику, пока она открыта. */
function finish(ctx: ShiftCtx, s: Shift): void {
  for (let i = 0; i < 40000 && !s.over; i++) {
    const cmd = botMove(ctx, s, BOTS.rules);
    if (cmd) expect(apply(ctx, s, cmd)).toBeNull();
    else {
      const next = nextEvent(ctx, s);
      advance(ctx, s, next === FAR ? 60_000 : Math.max(1, next - s.t));
    }
  }
  expect(s.over).toBe(true);
}

describe('поликлиника', () => {
  test('открыта только в сменах с ней (3–7) и с 8 до 20; в первой, второй и в смене прототипа — нет', () => {
    expect(week.map(w => w.clinic)).toEqual([false, false, true, true, true, true, true]);
    expect(DB.shifts['shift.proto'].clinic).toBe(false);
    for (const w of week) {
      const ctx = shiftCtx(DB, MED, w.id, map);
      const s = newShift(ctx, 1);
      const sec = (ctx.setup.start % 86_400) / 3600;
      expect(clinicOpen(ctx, s)).toBe(w.clinic && sec >= 8 && sec < 20);
    }
  });

  test('передать можно только неотложный, только открытой поликлинике и только один раз', () => {
    const ctx = shiftCtx(DB, MED, week[2].id, map);
    const s = newShift(ctx, 4);
    advance(ctx, s, nextEvent(ctx, s));
    expect(apply(ctx, s, { c: 'answer' })).toBeNull();
    const id = s.open!;
    expect(apply(ctx, s, { c: 'pass', call: id })).toBe('noForm');
    expect(apply(ctx, s, { c: 'form', form: 'emergency' })).toBeNull();
    expect(apply(ctx, s, { c: 'pass', call: id })).toBe('noForm');
    expect(callView(ctx, s, id)!.pass).toBe(false);
    // ночная смена: поликлиника закрыта
    const night = shiftCtx(DB, MED, week[3].id, map);
    const n = newShift(night, 4);
    advance(night, n, nextEvent(night, n));
    apply(night, n, { c: 'answer' });
    apply(night, n, { c: 'form', form: 'urgent' });
    expect(callView(night, n, n.open!)!.pass).toBe(false);
    expect(apply(night, n, { c: 'pass', call: n.open! })).toBe('clinicClosed');
  });

  test('врач поликлиники у больного за 40–120 минут; угроза — звонит, вызов снова решают; больница — просит бригаду; иначе — закрыт', () => {
    const seen = { served: 0, emergency: 0, urgent: 0 };
    for (const seed of [1, 2, 3, 4, 5]) {
      const ctx = shiftCtx(DB, MED, week[2].id, map);
      const { s } = play(ctx, seed, BOTS.rules);
      for (const c of s.calls) {
        if (!c.clinic) continue;
        const k = c.clinic;
        expect(k.arrive - k.at).toBeGreaterThanOrEqual(CLINIC_ARRIVE[0]);
        expect(k.arrive - k.at).toBeLessThanOrEqual(CLINIC_ARRIVE[1]);
        expect(c.decisions[0].form).toBe('urgent');
        if (k.back === null) {
          seen.served++;
          expect([c.state, c.arrivedAt, c.inAt, c.doneAt]).toEqual(['done', k.arrive, k.arrive, k.arrive]);
          expect(c.crew).toBeNull();
        } else {
          seen[k.back]++;
          expect(k.back).toBe(formByTruth(DB, c.truth) === 'emergency' ? 'emergency' : 'urgent');
          // вызов решили заново и послали бригаду — она приехала уже после врача поликлиники
          expect(c.decisions.length).toBeGreaterThan(1);
          expect(c.arrivedAt!).toBeGreaterThan(k.arrive);
          if (k.back === 'emergency') expect(c.decisions[c.decisions.length - 1].known).toBe('emergency');
        }
      }
    }
    expect(seen.served).toBeGreaterThan(0);
    expect(seen.emergency + seen.urgent).toBeGreaterThan(0);
  });

  test('звонок из поликлиники: говорит её врач; тот же вызов второй раз не передают', () => {
    const ctx = shiftCtx(DB, MED, week[2].id, map);
    let found = false;
    for (let seed = 1; seed <= 20 && !found; seed++) {
      const s = newShift(ctx, seed);
      for (let i = 0; i < 40000 && !s.over && !found; i++) {
        const ring = s.rings[0];
        const back = ring && s.calls.find(c => c.id === ring.call)?.clinic?.back;
        if (ring && back && !s.open) {
          expect(ring.clinic).toBe(true);
          expect(apply(ctx, s, { c: 'answer', ring: ring.id })).toBeNull();
          const v = callView(ctx, s, s.open!)!;
          expect(v.clinic).toBe(back);
          apply(ctx, s, { c: 'form', form: 'urgent' });
          expect(callView(ctx, s, s.open!)!.pass).toBe(false);
          expect(apply(ctx, s, { c: 'pass', call: s.open! })).toBe('clinicBack');
          found = true;
          break;
        }
        const cmd = botMove(ctx, s, BOTS.rules);
        if (cmd) apply(ctx, s, cmd);
        else advance(ctx, s, Math.max(1, Math.min(nextEvent(ctx, s), s.t + 60_000) - s.t));
      }
    }
    expect(found).toBe(true);
  });

  test('смена не ждёт вызовов, которые поликлиника закроет сама: они закрыты её приездом', () => {
    const ctx = shiftCtx(DB, MED, week[2].id, map);
    for (let seed = 1; seed <= 30; seed++) {
      const s = newShift(ctx, seed);
      finish(ctx, s);
      for (const c of s.calls) expect(c.state).toBe('done');
      const served = s.calls.filter(c => c.clinic && c.clinic.back === null);
      // хотя бы где-то врач поликлиники приехал уже после конца смены
      if (served.some(c => c.clinic!.arrive > s.t)) return;
    }
    throw new Error('ни в одной смене поликлиника не закрыла вызов после её конца');
  });
});
