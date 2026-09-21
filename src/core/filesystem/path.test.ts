import { describe, expect, it } from 'vitest';
import {
  basename,
  dirname,
  extname,
  isValidName,
  isWithin,
  join,
  normalize,
  resolve,
  segments,
  stem,
  tildify,
} from './path';

describe('normalize', () => {
  it('collapses duplicate and trailing slashes', () => {
    expect(normalize('/a//b/')).toBe('/a/b');
    expect(normalize('/')).toBe('/');
  });

  it('resolves . and ..', () => {
    expect(normalize('/a/b/../c')).toBe('/a/c');
    expect(normalize('/a/./b')).toBe('/a/b');
  });

  it('cannot escape above the root', () => {
    // Traversal must not be able to walk out of the virtual filesystem.
    expect(normalize('/../../etc/passwd')).toBe('/etc/passwd');
    expect(normalize('/a/../..')).toBe('/');
  });

  it('keeps leading .. on a relative path', () => {
    expect(normalize('../a')).toBe('../a');
  });
});

describe('resolve', () => {
  it('returns an absolute path unchanged', () => {
    expect(resolve('/Documents', '/Pictures/a.png')).toBe('/Pictures/a.png');
  });

  it('joins a relative path onto the base', () => {
    expect(resolve('/Documents', 'notes.txt')).toBe('/Documents/notes.txt');
    expect(resolve('/Documents/Projects', '../notes.txt')).toBe('/Documents/notes.txt');
  });

  it('handles the root as a base', () => {
    expect(resolve('/', 'Documents')).toBe('/Documents');
  });
});

describe('path components', () => {
  it('splits into segments', () => {
    expect(segments('/a/b/c')).toEqual(['a', 'b', 'c']);
    expect(segments('/')).toEqual([]);
  });

  it('finds the parent directory', () => {
    expect(dirname('/a/b/c.txt')).toBe('/a/b');
    expect(dirname('/a.txt')).toBe('/');
    expect(dirname('/')).toBe('/');
  });

  it('finds the file name', () => {
    expect(basename('/a/b/c.txt')).toBe('c.txt');
    expect(basename('/')).toBe('/');
  });

  it('reads the extension, lowercased', () => {
    expect(extname('report.TXT')).toBe('txt');
    expect(extname('archive.tar.gz')).toBe('gz');
    expect(extname('README')).toBe('');
  });

  it('treats a dotfile as having no extension', () => {
    expect(extname('.bashrc')).toBe('');
    expect(stem('.bashrc')).toBe('.bashrc');
  });

  it('reads the stem', () => {
    expect(stem('/a/report.txt')).toBe('report');
  });

  it('joins parts', () => {
    expect(join('/a', 'b', 'c.txt')).toBe('/a/b/c.txt');
  });
});

describe('isWithin', () => {
  it('matches a path against itself', () => {
    expect(isWithin('/Documents', '/Documents')).toBe(true);
  });

  it('matches descendants', () => {
    expect(isWithin('/Documents', '/Documents/Projects/a.txt')).toBe(true);
    expect(isWithin('/', '/anything')).toBe(true);
  });

  it('does not match a sibling with a shared prefix', () => {
    expect(isWithin('/Doc', '/Documents')).toBe(false);
  });
});

describe('isValidName', () => {
  it('accepts ordinary names', () => {
    expect(isValidName('report.txt')).toBe(true);
    expect(isValidName('My Folder')).toBe(true);
  });

  it('rejects names that would break path parsing', () => {
    expect(isValidName('a/b')).toBe(false);
    expect(isValidName('a\\b')).toBe(false);
    expect(isValidName('.')).toBe(false);
    expect(isValidName('..')).toBe(false);
  });

  it('rejects empty and whitespace-only names', () => {
    expect(isValidName('')).toBe(false);
    expect(isValidName('   ')).toBe(false);
  });

  it('rejects control characters', () => {
    expect(isValidName('a\u0000b')).toBe(false);
    expect(isValidName('a\nb')).toBe(false);
  });

  it('rejects absurdly long names', () => {
    expect(isValidName('x'.repeat(256))).toBe(false);
  });
});

describe('tildify', () => {
  it('abbreviates the home prefix', () => {
    expect(tildify('/', '/')).toBe('~');
    expect(tildify('/Documents', '/')).toBe('~/Documents');
  });
});
