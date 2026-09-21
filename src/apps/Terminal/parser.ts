/**
 * Shell line parser.
 *
 * Supports quoting, pipelines and output redirection — enough to make the
 * terminal feel like a shell without pretending to be bash. There is no
 * `eval`, no subshells and no command substitution: every token is data.
 */

export interface Redirection {
  /** `>` truncates, `>>` appends. */
  mode: 'write' | 'append';
  target: string;
}

export interface ParsedCommand {
  name: string;
  args: string[];
  /** Applies to the last command in a pipeline. */
  redirect?: Redirection;
  /** `< file` feeds a file into the first command's stdin. */
  inputFrom?: string;
}

/** How a pipeline is joined to the one before it. */
export type SequenceOperator = ';' | '&&' | '||';

export interface ParsedSequenceItem {
  pipeline: ParsedCommand[];
  /** `null` for the first item in the line. */
  joinedBy: SequenceOperator | null;
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

type Operator = '|' | '>' | '>>' | '<' | ';' | '&&' | '||';

interface Token {
  value: string;
  /** Operators are never treated as arguments. */
  operator?: Operator;
}

function tokenize(line: string): Token[] {
  const tokens: Token[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  const push = () => {
    if (hasContent || current.length > 0) {
      tokens.push({ value: current });
      current = '';
      hasContent = false;
    }
  };

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quote) {
      if (char === quote) {
        quote = null;
        hasContent = true;
      } else if (char === '\\' && quote === '"' && index + 1 < line.length) {
        index += 1;
        current += line[index];
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }

    if (char === '\\' && index + 1 < line.length) {
      index += 1;
      current += line[index];
      continue;
    }

    if (/\s/.test(char)) {
      push();
      continue;
    }

    if (char === '|') {
      push();
      if (line[index + 1] === '|') {
        index += 1;
        tokens.push({ value: '||', operator: '||' });
      } else {
        tokens.push({ value: '|', operator: '|' });
      }
      continue;
    }

    if (char === '&') {
      push();
      if (line[index + 1] === '&') {
        index += 1;
        tokens.push({ value: '&&', operator: '&&' });
        continue;
      }
      // A single `&` would mean "run in the background", which this shell has
      // no concept of; treating it as an ordinary character is less surprising
      // than silently dropping it.
      current += char;
      continue;
    }

    if (char === ';') {
      push();
      tokens.push({ value: ';', operator: ';' });
      continue;
    }

    if (char === '<') {
      push();
      tokens.push({ value: '<', operator: '<' });
      continue;
    }

    if (char === '>') {
      push();
      if (line[index + 1] === '>') {
        index += 1;
        tokens.push({ value: '>>', operator: '>>' });
      } else {
        tokens.push({ value: '>', operator: '>' });
      }
      continue;
    }

    current += char;
  }

  if (quote) throw new ParseError(`Unclosed ${quote === '"' ? 'double' : 'single'} quote`);
  push();
  return tokens;
}

/**
 * Split a line into a sequence of pipelines.
 *
 * `;` always runs the next pipeline, `&&` only after success and `||` only
 * after failure — the three forms people actually reach for.
 */
export function parseLine(line: string): ParsedSequenceItem[] {
  const tokens = tokenize(line);
  if (tokens.length === 0) return [];

  const sequence: ParsedSequenceItem[] = [];
  let pipeline: ParsedCommand[] = [];
  let current: ParsedCommand | null = null;
  let joinedBy: SequenceOperator | null = null;
  let pending: 'redirect-write' | 'redirect-append' | 'input' | null = null;

  const endPipeline = (nextJoin: SequenceOperator) => {
    if (!current && pipeline.length === 0) throw new ParseError(`"${nextJoin}" without a command before it`);
    if (!current) throw new ParseError('Pipe without a command on the right');
    pipeline.push(current);
    sequence.push({ pipeline, joinedBy });
    pipeline = [];
    current = null;
    joinedBy = nextJoin;
  };

  for (const token of tokens) {
    if (pending) {
      if (token.operator) throw new ParseError(`Expected a file name after "${pending === 'input' ? '<' : '>'}"`);
      if (!current) throw new ParseError('Redirection without a command');
      if (pending === 'input') current.inputFrom = token.value;
      else current.redirect = { mode: pending === 'redirect-append' ? 'append' : 'write', target: token.value };
      pending = null;
      continue;
    }

    switch (token.operator) {
      case '|':
        if (!current) throw new ParseError('Pipe without a command on the left');
        pipeline.push(current);
        current = null;
        continue;
      case ';':
      case '&&':
      case '||':
        endPipeline(token.operator);
        continue;
      case '>':
      case '>>':
        pending = token.operator === '>' ? 'redirect-write' : 'redirect-append';
        continue;
      case '<':
        pending = 'input';
        continue;
      default:
        break;
    }

    if (!current) current = { name: token.value, args: [] };
    else current.args.push(token.value);
  }

  if (pending) throw new ParseError('Expected a file name after a redirection');

  if (current) {
    pipeline.push(current);
    sequence.push({ pipeline, joinedBy });
  } else if (pipeline.length > 0) {
    throw new ParseError('Pipe without a command on the right');
  } else if (sequence.length > 0) {
    throw new ParseError('Line ends with an operator');
  }

  return sequence;
}

/** Split flags from positional arguments: `-la` becomes `l` and `a`. */
export function parseFlags(args: string[]): { flags: Set<string>; long: Set<string>; positional: string[] } {
  const flags = new Set<string>();
  const long = new Set<string>();
  const positional: string[] = [];

  for (const arg of args) {
    if (arg === '--') {
      continue;
    }
    if (arg.startsWith('--') && arg.length > 2) {
      long.add(arg.slice(2));
    } else if (arg.startsWith('-') && arg.length > 1 && !/^-\d/.test(arg)) {
      for (const char of arg.slice(1)) flags.add(char);
    } else {
      positional.push(arg);
    }
  }

  return { flags, long, positional };
}
