import {describe, expect, it} from 'vitest';
import {evaluateAmount, isExpression, roundToMinorUnit} from './mathEval';

describe('evaluateAmount', () => {
  it('parses plain numbers', () => {
    expect(evaluateAmount('250')).toBe(250);
    expect(evaluateAmount('0')).toBe(0);
    expect(evaluateAmount('.5')).toBe(0.5);
    expect(evaluateAmount('1250.75')).toBe(1250.75);
  });

  it('evaluates the expressions from the old app README', () => {
    expect(evaluateAmount('250 + 120 * 1.05')).toBeCloseTo(376, 10);
    expect(evaluateAmount('4500 / 3')).toBe(1500);
    expect(evaluateAmount('1200 + 450 + 900')).toBe(2550);
  });

  it('respects operator precedence', () => {
    expect(evaluateAmount('2+3*4')).toBe(14);
    expect(evaluateAmount('(2+3)*4')).toBe(20);
    expect(evaluateAmount('100-20-30')).toBe(50); // left-associative
    expect(evaluateAmount('100/5/2')).toBe(10);
  });

  it('handles unary signs', () => {
    expect(evaluateAmount('-500')).toBe(-500);
    expect(evaluateAmount('+500')).toBe(500);
    expect(evaluateAmount('10 - -5')).toBe(15);
    expect(evaluateAmount('-(2+3)')).toBe(-5);
  });

  it('strips whitespace and currency symbols', () => {
    expect(evaluateAmount('৳ 1200')).toBe(1200);
    expect(evaluateAmount('$1,200 + $300')).toBe(1500);
    expect(evaluateAmount('  42  ')).toBe(42);
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(evaluateAmount('')).toBeNull();
    expect(evaluateAmount('   ')).toBeNull();
    expect(evaluateAmount('৳')).toBeNull();
  });

  it('returns null for division by zero rather than Infinity', () => {
    expect(evaluateAmount('100/0')).toBeNull();
    expect(evaluateAmount('100/(5-5)')).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(evaluateAmount('abc')).toBeNull();
    expect(evaluateAmount('1 + ')).toBeNull();
    expect(evaluateAmount('1 ++')).toBeNull();
    expect(evaluateAmount('*5')).toBeNull();
    expect(evaluateAmount('1.2.3')).toBeNull();
  });

  it('concatenates space-separated digits, matching the old app', () => {
    // Whitespace is stripped before parsing, so "5 5" is "55". Surprising in
    // isolation, but it is the behaviour users already have, and treating it
    // as an error would reject amounts typed with digit grouping.
    expect(evaluateAmount('5 5')).toBe(55);
    expect(evaluateAmount('1 200')).toBe(1200);
  });

  it('rejects unclosed parentheses (deviation from the old app)', () => {
    // The original silently returned 3 here.
    expect(evaluateAmount('(1+2')).toBeNull();
    expect(evaluateAmount('((1+2)')).toBeNull();
  });

  it('does not execute arbitrary code', () => {
    expect(evaluateAmount('process.exit(1)')).toBeNull();
    expect(evaluateAmount('1;alert(1)')).toBeNull();
    expect(evaluateAmount('[].constructor')).toBeNull();
  });
});

describe('isExpression', () => {
  it('is false for plain amounts, including signed ones', () => {
    expect(isExpression('500')).toBe(false);
    expect(isExpression('-500')).toBe(false);
    expect(isExpression('1250.75')).toBe(false);
  });

  it('is true when an operator is present', () => {
    expect(isExpression('1+2')).toBe(true);
    expect(isExpression('4500/3')).toBe(true);
    expect(isExpression('(2+3)*4')).toBe(true);
  });
});

describe('roundToMinorUnit', () => {
  it('resolves float drift from division', () => {
    // 4500/3 is exact, but 1000/3 is not.
    expect(roundToMinorUnit(1000 / 3)).toBe(333.33);
    expect(roundToMinorUnit(0.1 + 0.2)).toBe(0.3);
  });

  it('supports zero-decimal currencies', () => {
    expect(roundToMinorUnit(1499.6, 0)).toBe(1500);
  });
});
