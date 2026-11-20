// Обёртка прототипа (часть П8; спецификация, §3, §5, §6): учебные звонки — такие, как в спецификации, с подсказками по
// шагам; свет карты — к 19:00 вечер; лучший итог — больше экстренных в норму; след бригад — настоящие рёбра пути.
import { describe, expect, test } from 'bun:test';
import { DB } from '../../src/content/generated/db';
import { MED } from '../../src/content/generated/med';
import { formByKnown } from '../../src/engine/form';
import { advance, apply, crewOptions, newShift, shiftCtx } from '../../src/engine/shift';
import { loadMap } from '../../src/map/load';
import { better } from '../../src/state/progress';
import { callHint, pultHint } from '../../src/state/tutorial';
import { duskOf } from '../../src/ui/map/palette';
import { BOTS, play } from '../sim/bots';

const ctx = shiftCtx(DB, MED, 'shift.proto', loadMap(DB.cities['city.proto'].map));

describe('учебные звонки', () => {
  test('первый: «не отвечает» сразу; подсказки — спросить, как дышит, экстренная, ближайшая бригада', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const s = newShift(ctx, seed);
      advance(ctx, s, ctx.setup.script[0].at * 1000);
      expect(pultHint(ctx, s)).toBe('ring');
      apply(ctx, s, { c: 'answer' });
      const call = s.calls[0];
      expect(call.first!.reason).toBe('reason.not_responding');
      expect(callHint(ctx, s, call.id)).toBe('askBreathing');
      apply(ctx, s, { c: 'ask', q: 'q.breathing' });
      expect(callHint(ctx, s, call.id)).toBe('formEmergency');
      expect(formByKnown(DB, new Map(Object.entries(call.heard)))).toBe('emergency');
      apply(ctx, s, { c: 'form', form: 'emergency' });
      expect(callHint(ctx, s, call.id)).toBe('sendNearest');
      apply(ctx, s, { c: 'send', call: call.id, crew: crewOptions(ctx, s, call.id)[0].crew });
      expect(pultHint(ctx, s)).toBe('clock');
    }
  });

  test('второй — сам больной говорит о температуре; третий — прохожий, первые слова смутные', () => {
    for (const seed of [1, 2, 3]) {
      const s = play(ctx, seed, BOTS.rules).s;
      const [, second, third] = s.calls;
      expect(second.truth.caller).toBe('caller.self');
      expect(second.first!.reason).toBe('reason.fever');
      expect(third.truth.caller).toBe('caller.bystander');
      expect(third.first!.reason).toBe('reason.unwell');
      expect(callHint(ctx, s, s.calls[4].id)).toBeNull();
    }
  });
});

describe('обёртка', () => {
  test('свет карты: днём светло, к 19:00 вечер, ночью темно', () => {
    expect(duskOf(12 * 3600)).toBe(0);
    expect(duskOf(17 * 3600)).toBeCloseTo(0.5);
    expect(duskOf(19 * 3600)).toBe(1);
    expect(duskOf(2 * 3600)).toBe(1);
    expect(duskOf(6 * 3600)).toBeCloseTo(0.5);
  });

  test('лучший итог — больше экстренных в норму по доле, при равной — короче ожидание неотложных', () => {
    const a = { emergency: 10, inNorm: 9, urgentMedian: 1_800_000, accepted: 20 };
    expect(better(a, null)).toBe(true);
    expect(better(a, { ...a, inNorm: 8 })).toBe(true);
    expect(better(a, { ...a, urgentMedian: 1_200_000 })).toBe(false);
    expect(better({ ...a, emergency: 0, inNorm: 0 }, a)).toBe(true);
  });

  test('след бригад — настоящие рёбра пути, по одному следу на выезд', () => {
    const s = play(ctx, 2, BOTS.rules).s;
    expect(s.trail.length).toBeGreaterThan(s.calls.length);
    const m = ctx.map;
    for (const t of s.trail) {
      expect(t.edges.length).toBe(t.nodes.length - 1);
      t.edges.forEach((e, i) => expect([m.edges.a[e], m.edges.b[e]]).toContain(t.nodes[i]));
    }
  });
});
