// Пробная смена (часть П3; src/state/proto.ts): решение шлёт ближайшую свободную бригаду по одному обратному поиску,
// часы смены двигают бригады по их кругу, рация говорит, кто на месте; знаки бригад в одном месте не ложатся друг на друга.
import { beforeEach, describe, expect, test } from 'bun:test';
import { etas, free } from '../../src/engine/crews';
import { FAR } from '../../src/engine/road/route';
import { slots } from '../../src/scenes/pult/slots';
import { decide, exampleCallNode, noDispatch, ON_SCENE, protoState, resetProto, setSpeed, SPEED_X1, tick } from '../../src/state/proto';

describe('пробная смена', () => {
  beforeEach(() => resetProto());

  test('решение: ближайшая свободная бригада, часы — на время разговора, линия короче', () => {
    const s0 = protoState();
    const node = exampleCallNode();
    const want = etas(s0.road, s0.times, s0.crews, node, s0.t + 75_000);
    const best = want.reduce((b, d, i) => (d !== FAR && (b < 0 || d < want[b]) ? i : b), -1);
    const n = decide('call.41', node, 'emergency', 75);
    const s = protoState();
    expect(s.t).toBe(75_000);
    expect(s.line).toBe(s0.line - 1);
    expect(n).toBe(Number(s.crews[best].id.split('.')[1]));
    expect(s.crews[best].state).toBe('drive');
    expect(s.calls.find(c => c.id === 'call.41')!.crew).toBe(s.crews[best].id);
  });

  test('часы двигают бригаду: доехала — «на месте» по рации, отработала — домой', () => {
    decide('call.41', exampleCallNode(), 'emergency', 30);
    const crew = protoState().crews.find(c => c.state === 'drive')!;
    const there = crew.route!.start + crew.route!.at[crew.route!.at.length - 1];
    setSpeed(1);
    tick((there - protoState().t) / SPEED_X1 + 1);
    const on = protoState().crews.find(c => c.id === crew.id)!;
    expect(on.state).toBe('scene');
    expect(protoState().radio).toEqual({ crew: Number(crew.id.split('.')[1]), what: 'scene' });
    tick(ON_SCENE / SPEED_X1 + 1);
    expect(protoState().crews.find(c => c.id === crew.id)!.state).toBe('back');
    expect(free(protoState().crews.find(c => c.id === crew.id)!)).toBe(true);
  });

  test('пауза держит часы; без выезда — только линия и время разговора', () => {
    setSpeed(0);
    tick(10_000);
    expect(protoState().t).toBe(0);
    noDispatch(40);
    expect(protoState().t).toBe(40_000);
    expect(protoState().line).toBe(1);
  });

  test('знаки бригад в одном узле — рядом, не друг на друге', () => {
    const off = slots(protoState().crews);
    const crews = protoState().crews;
    for (let i = 0; i < crews.length; i++) {
      for (let j = i + 1; j < crews.length; j++) {
        if (crews[i].at === crews[j].at) expect(off[i]).not.toEqual(off[j]);
      }
    }
  });
});
