/**
 * Calculator engine.
 *
 * A small shunting-yard parser and RPN evaluator. Expressions are never passed
 * to `eval` or `new Function`: the OS treats all app-facing input as untrusted,
 * and a 90-line parser is both safer and gives better error messages.
 */

export type Token =
  | { type: 'number'; value: number }
  | { type: 'operator'; value: string }
  | { type: 'function'; value: string }
  | { type: 'paren'; value: '(' | ')' }
  | { type: 'constant'; value: string };

export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalculationError';
  }
}

const OPERATORS: Record<string, { precedence: number; associativity: 'left' | 'right'; apply: (a: number, b: number) => number }> = {
  '+': { precedence: 1, associativity: 'left', apply: (a, b) => a + b },
  '-': { precedence: 1, associativity: 'left', apply: (a, b) => a - b },
  '*': { precedence: 2, associativity: 'left', apply: (a, b) => a * b },
  '/': {
    precedence: 2,
    associativity: 'left',
    apply: (a, b) => {
      if (b === 0) throw new CalculationError('Cannot divide by zero');
      return a / b;
    },
  },
  '%': {
    precedence: 2,
    associativity: 'left',
    apply: (a, b) => {
      if (b === 0) throw new CalculationError('Cannot take a remainder of zero');
      return a % b;
    },
  },
  '^': { precedence: 4, associativity: 'right', apply: (a, b) => a ** b },
};

const FUNCTIONS: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  ln: (x) => {
    if (x <= 0) throw new CalculationError('ln needs a positive number');
    return Math.log(x);
  },
  log: (x) => {
    if (x <= 0) throw new CalculationError('log needs a positive number');
    return Math.log10(x);
  },
  sqrt: (x) => {
    if (x < 0) throw new CalculationError('Cannot take the square root of a negative number');
    return Math.sqrt(x);
  },
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
};

const CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  e: Math.E,
};

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[\d.]/.test(char)) {
      let literal = '';
      while (index < input.length && /[\d.]/.test(input[index])) {
        literal += input[index];
        index += 1;
      }
      const value = Number(literal);
      if (!Number.isFinite(value)) throw new CalculationError(`"${literal}" is not a number`);
      tokens.push({ type: 'number', value });
      continue;
    }

    if (/[a-z]/i.test(char)) {
      let word = '';
      while (index < input.length && /[a-z]/i.test(input[index])) {
        word += input[index];
        index += 1;
      }
      const lower = word.toLowerCase();
      if (FUNCTIONS[lower]) tokens.push({ type: 'function', value: lower });
      else if (CONSTANTS[lower] !== undefined) tokens.push({ type: 'constant', value: lower });
      else throw new CalculationError(`Unknown name "${word}"`);
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ type: 'paren', value: char });
      index += 1;
      continue;
    }

    if (OPERATORS[char]) {
      // A leading '-' (or one after '(' or another operator) is a negation.
      const previous = tokens[tokens.length - 1];
      const isUnary =
        char === '-' &&
        (!previous ||
          previous.type === 'operator' ||
          (previous.type === 'paren' && previous.value === '('));
      if (isUnary) {
        tokens.push({ type: 'number', value: -1 });
        tokens.push({ type: 'operator', value: '*' });
      } else {
        tokens.push({ type: 'operator', value: char });
      }
      index += 1;
      continue;
    }

    throw new CalculationError(`Unexpected character "${char}"`);
  }

  return tokens;
}

/** Shunting-yard: infix tokens → reverse Polish notation. */
export function toRPN(tokens: Token[]): Token[] {
  const output: Token[] = [];
  const stack: Token[] = [];

  for (const token of tokens) {
    switch (token.type) {
      case 'number':
      case 'constant':
        output.push(token);
        break;
      case 'function':
        stack.push(token);
        break;
      case 'operator': {
        const current = OPERATORS[token.value];
        while (stack.length > 0) {
          const top = stack[stack.length - 1];
          if (top.type === 'function') {
            output.push(stack.pop()!);
            continue;
          }
          if (top.type !== 'operator') break;
          const other = OPERATORS[top.value];
          const takesPrecedence =
            other.precedence > current.precedence ||
            (other.precedence === current.precedence && current.associativity === 'left');
          if (!takesPrecedence) break;
          output.push(stack.pop()!);
        }
        stack.push(token);
        break;
      }
      case 'paren':
        if (token.value === '(') {
          stack.push(token);
        } else {
          let matched = false;
          while (stack.length > 0) {
            const top = stack.pop()!;
            if (top.type === 'paren' && top.value === '(') {
              matched = true;
              break;
            }
            output.push(top);
          }
          if (!matched) throw new CalculationError('Unbalanced brackets');
          const top = stack[stack.length - 1];
          if (top?.type === 'function') output.push(stack.pop()!);
        }
        break;
    }
  }

  while (stack.length > 0) {
    const top = stack.pop()!;
    if (top.type === 'paren') throw new CalculationError('Unbalanced brackets');
    output.push(top);
  }

  return output;
}

export function evaluateRPN(rpn: Token[], degrees = false): number {
  const stack: number[] = [];
  const toRadians = (x: number) => (degrees ? (x * Math.PI) / 180 : x);
  const fromRadians = (x: number) => (degrees ? (x * 180) / Math.PI : x);
  const TRIG_IN = new Set(['sin', 'cos', 'tan']);
  const TRIG_OUT = new Set(['asin', 'acos', 'atan']);

  for (const token of rpn) {
    if (token.type === 'number') {
      stack.push(token.value);
    } else if (token.type === 'constant') {
      stack.push(CONSTANTS[token.value]);
    } else if (token.type === 'function') {
      const argument = stack.pop();
      if (argument === undefined) throw new CalculationError(`"${token.value}" is missing its argument`);
      const input = TRIG_IN.has(token.value) ? toRadians(argument) : argument;
      const result = FUNCTIONS[token.value](input);
      stack.push(TRIG_OUT.has(token.value) ? fromRadians(result) : result);
    } else if (token.type === 'operator') {
      const b = stack.pop();
      const a = stack.pop();
      if (a === undefined || b === undefined) throw new CalculationError('Incomplete expression');
      stack.push(OPERATORS[token.value].apply(a, b));
    }
  }

  if (stack.length !== 1) throw new CalculationError('Incomplete expression');
  const result = stack[0];
  if (!Number.isFinite(result)) throw new CalculationError('Result is not a finite number');
  return result;
}

export function calculate(expression: string, degrees = false): number {
  const trimmed = expression.trim();
  if (trimmed.length === 0) throw new CalculationError('Nothing to calculate');
  return evaluateRPN(toRPN(tokenize(trimmed)), degrees);
}

/** Format a result without exponent noise for everyday numbers. */
export function formatResult(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  const absolute = Math.abs(value);
  if (absolute !== 0 && (absolute < 1e-6 || absolute >= 1e15)) return value.toExponential(8).replace(/\.?0+e/, 'e');
  return String(Number(value.toPrecision(12)));
}
