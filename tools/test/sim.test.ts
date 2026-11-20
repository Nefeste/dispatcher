// «Виртуальный диспетчер» (спецификация прототипа, критерий 7, пороги §4): на 100 сменах «по правилам» — не меньше
// 85 % экстренных с доездом в норму; «без вопросов» и «всё экстренно» — хуже хотя бы на 20 п. п. Если числа баланса
// поменялись и порог упал — менять числа, а не порог (отчёт — docs/reports/virtual-dispatcher.md).
import { describe, expect, test } from 'bun:test';
import { simulate } from '../sim/shift';

describe('виртуальный диспетчер', () => {
  test('пороги §4 на 100 сменах', () => {
    const rows = simulate(100, ['rules', 'noQuestions', 'allEmergency']);
    const pct = Object.fromEntries(rows.map(r => [r.bot, (100 * r.inNorm) / r.emergency]));
    expect(pct.rules).toBeGreaterThanOrEqual(85);
    expect(pct.rules - pct.noQuestions).toBeGreaterThanOrEqual(20);
    expect(pct.rules - pct.allEmergency).toBeGreaterThanOrEqual(20);
  }, 180_000);
});
