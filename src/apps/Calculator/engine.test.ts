import { describe, expect, it } from 'vitest';
import { CalculationError, calculate, formatResult } from './engine';

const evalOf = (expression: string, degrees = false) => calculate(expression, degrees);

describe('arithmetic', () => {
  it('applies operator precedence', () => {
    expect(evalOf('2 + 3 * 4')).toBe(14);
    expect(evalOf('(2 + 3) * 4')).toBe(20);
  });

  it('is right-associative for exponentiation', () => {
    expect(evalOf('2 ^ 3 ^ 2')).toBe(512);
  });

  it('handles the mixed expression used as a smoke test', () => {
    expect(evalOf('sqrt(144) + 2^5 * (3 - 1)')).toBe(76);
  });

  it('supports unary minus in every position', () => {
    expect(evalOf('-7 + 3')).toBe(-4);
    expect(evalOf('3 * -2')).toBe(-6);
    expect(evalOf('(-4)')).toBe(-4);
  });

  it('computes remainders', () => {
    expect(evalOf('10 % 3')).toBe(1);
  });

  it('reads decimals', () => {
    expect(evalOf('0.1 + 0.2')).toBeCloseTo(0.3, 10);
  });
});

describe('functions and constants', () => {
  it('treats bare trigonometric input as radians', () => {
    expect(evalOf('sin(0)')).toBe(0);
    expect(evalOf('cos(0)')).toBe(1);
  });

  it('converts when degrees mode is on', () => {
    expect(evalOf('sin(90)', true)).toBeCloseTo(1, 10);
    expect(evalOf('cos(180)', true)).toBeCloseTo(-1, 10);
  });

  it('converts inverse trigonometry back out of radians', () => {
    expect(evalOf('asin(1)', true)).toBeCloseTo(90, 10);
  });

  it('knows pi and e', () => {
    expect(evalOf('pi')).toBeCloseTo(Math.PI, 12);
    expect(evalOf('e')).toBeCloseTo(Math.E, 12);
  });

  it('nests function calls', () => {
    expect(evalOf('sqrt(abs(-16))')).toBe(4);
  });
});

describe('errors', () => {
  it('refuses to divide by zero', () => {
    expect(() => evalOf('5 / 0')).toThrow(/divide by zero/i);
  });

  it('rejects logarithms of non-positive numbers', () => {
    expect(() => evalOf('ln(0)')).toThrow(/positive/i);
    expect(() => evalOf('log(-1)')).toThrow(/positive/i);
  });

  it('rejects the square root of a negative number', () => {
    expect(() => evalOf('sqrt(-1)')).toThrow(/negative/i);
  });

  it('reports incomplete expressions', () => {
    expect(() => evalOf('2 +')).toThrow(/incomplete/i);
    expect(() => evalOf('')).toThrow(CalculationError);
  });

  it('reports unbalanced brackets', () => {
    expect(() => evalOf('(2 + 3')).toThrow(/bracket/i);
    expect(() => evalOf('2 + 3)')).toThrow(/bracket/i);
  });

  it('names an unknown function rather than failing vaguely', () => {
    expect(() => evalOf('nope(2)')).toThrow(/unknown name "nope"/i);
  });

  it('rejects characters that are not part of the grammar', () => {
    expect(() => evalOf('2 $ 3')).toThrow(/unexpected character/i);
  });

  /*
   * The engine is a hand-written parser specifically so that expressions are
   * never handed to eval(). An expression that looks like code must be a
   * parse error, not something that runs.
   */
  it('does not evaluate anything resembling JavaScript', () => {
    expect(() => evalOf('globalThis')).toThrow(CalculationError);
    expect(() => evalOf('[].constructor')).toThrow(CalculationError);
  });
});

describe('formatResult', () => {
  it('leaves whole numbers alone', () => {
    expect(formatResult(76)).toBe('76');
    expect(formatResult(-4)).toBe('-4');
  });

  it('trims floating point noise', () => {
    expect(formatResult(0.1 + 0.2)).toBe('0.3');
  });

  it('uses exponent notation only at the extremes', () => {
    expect(formatResult(1e20)).toMatch(/e\+?20/);
    expect(formatResult(0.5)).toBe('0.5');
  });
});
