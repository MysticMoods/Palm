import { describe, expect, it } from 'vitest';
import { ParseError, parseFlags, parseLine } from './parser';

/** Collapse a parse result to `name arg arg | name arg` for readable assertions. */
const shape = (line: string) =>
  parseLine(line).map((item) => ({
    joinedBy: item.joinedBy,
    pipeline: item.pipeline.map((c) => [c.name, ...c.args].join(' ')).join(' | '),
    redirect: item.pipeline.at(-1)?.redirect,
    inputFrom: item.pipeline[0]?.inputFrom,
  }));

describe('tokenising', () => {
  it('splits on whitespace', () => {
    expect(shape('ls -la /Documents')[0].pipeline).toBe('ls -la /Documents');
  });

  it('keeps quoted strings together', () => {
    expect(shape('echo "hello world"')[0].pipeline).toBe('echo hello world');
    expect(parseLine('echo "hello world"')[0].pipeline[0].args).toEqual(['hello world']);
  });

  it('treats single quotes literally', () => {
    expect(parseLine(`echo 'a "b" c'`)[0].pipeline[0].args).toEqual(['a "b" c']);
  });

  it('honours backslash escapes outside quotes', () => {
    expect(parseLine('touch my\\ file.txt')[0].pipeline[0].args).toEqual(['my file.txt']);
  });

  it('preserves an empty quoted argument', () => {
    expect(parseLine('echo ""')[0].pipeline[0].args).toEqual(['']);
  });

  it('rejects an unclosed quote', () => {
    expect(() => parseLine('echo "oops')).toThrow(ParseError);
  });

  it('returns nothing for blank input', () => {
    expect(parseLine('')).toEqual([]);
    expect(parseLine('   ')).toEqual([]);
  });
});

describe('pipelines', () => {
  it('splits on |', () => {
    expect(shape('cat a.txt | grep palm | wc')[0].pipeline).toBe('cat a.txt | grep palm | wc');
  });

  it('rejects a pipe with nothing on the left', () => {
    expect(() => parseLine('| wc')).toThrow(ParseError);
  });

  it('rejects a pipe with nothing on the right', () => {
    expect(() => parseLine('ls |')).toThrow(ParseError);
  });
});

describe('redirection', () => {
  it('parses truncating output', () => {
    expect(shape('echo hi > out.txt')[0].redirect).toEqual({ mode: 'write', target: 'out.txt' });
  });

  it('parses appending output', () => {
    expect(shape('echo hi >> out.txt')[0].redirect).toEqual({ mode: 'append', target: 'out.txt' });
  });

  it('parses input redirection', () => {
    expect(shape('wc < in.txt')[0].inputFrom).toBe('in.txt');
  });

  it('attaches the redirect to the last command in a pipeline', () => {
    const [item] = parseLine('cat a | wc > out.txt');
    expect(item.pipeline[0].redirect).toBeUndefined();
    expect(item.pipeline[1].redirect).toEqual({ mode: 'write', target: 'out.txt' });
  });

  it('rejects a redirect with no file name', () => {
    expect(() => parseLine('echo hi >')).toThrow(ParseError);
    expect(() => parseLine('echo hi > | wc')).toThrow(ParseError);
  });
});

describe('sequences', () => {
  /*
   * These operators were originally parsed as ordinary arguments, so
   * `mkdir a && ls` tried to create directories called "&&" and "ls".
   */
  it('splits on && and records the join', () => {
    expect(shape('mkdir a && ls')).toEqual([
      { joinedBy: null, pipeline: 'mkdir a', redirect: undefined, inputFrom: undefined },
      { joinedBy: '&&', pipeline: 'ls', redirect: undefined, inputFrom: undefined },
    ]);
  });

  it('splits on ; and ||', () => {
    expect(shape('a ; b || c').map((i) => i.joinedBy)).toEqual([null, ';', '||']);
  });

  it('combines sequences with pipelines and redirects', () => {
    const parsed = shape('cat a | wc > out.txt ; echo done');
    expect(parsed).toHaveLength(2);
    expect(parsed[0].pipeline).toBe('cat a | wc');
    expect(parsed[0].redirect).toEqual({ mode: 'write', target: 'out.txt' });
    expect(parsed[1].pipeline).toBe('echo done');
  });

  it('keeps a single & as an ordinary character', () => {
    // There is no job control here, so "&" is not an operator.
    expect(parseLine('echo a&b')[0].pipeline[0].args).toEqual(['a&b']);
  });

  it('rejects a trailing operator', () => {
    expect(() => parseLine('ls &&')).toThrow(ParseError);
    expect(() => parseLine('&& ls')).toThrow(ParseError);
  });
});

describe('parseFlags', () => {
  it('expands clustered short flags', () => {
    const { flags, positional } = parseFlags(['-la', '/Documents']);
    expect([...flags].sort()).toEqual(['a', 'l']);
    expect(positional).toEqual(['/Documents']);
  });

  it('collects long flags separately', () => {
    const { long } = parseFlags(['--depth=2']);
    expect([...long]).toEqual(['depth=2']);
  });

  it('treats a negative number as a positional argument, not a flag', () => {
    expect(parseFlags(['-3']).positional).toEqual(['-3']);
  });
});
