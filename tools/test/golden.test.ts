// Золотая смена (критерий 2 спецификации): записанные зерно и команды → тот же отпечаток состояния и разбора.
// Отпечаток поменялся нарочно — `bun tools/test/golden.ts --write` и строка в описании PR, что поменялось.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { advance, replay } from '../../src/engine/shift';
import { ctx, GOLDEN, type Golden, printReview, printState } from './golden';

describe('золотая смена', () => {
  const runs = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Golden[];
  for (const g of runs) {
    test(`${g.bot}, зерно ${g.seed}: состояние и разбор — те же`, () => {
      const s = replay(ctx, g.seed, g.log);
      advance(ctx, s, g.t - s.t);
      expect(s.over).toBe(true);
      expect(printState(s)).toBe(g.state);
      expect(printReview(s)).toBe(g.review);
    });
  }
});
