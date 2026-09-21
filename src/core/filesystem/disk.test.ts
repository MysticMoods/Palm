import { beforeEach, describe, expect, it } from 'vitest';
import { DiskError, DiskVolume } from './disk';
import { fakeDirectory } from './fake-handles';
import type { FakeDirectoryHandle } from './fake-handles';

let root: FakeDirectoryHandle;
let volume: DiskVolume;

beforeEach(() => {
  root = fakeDirectory('my-project', {
    'README.md': '# My Project\n\nHello.',
    'notes.txt': 'plain text',
    'photo.png': 'PNGDATA',
    src: {
      'main.ts': 'export const main = 1;',
      'helper.ts': 'export const helper = 2;',
      deep: { 'buried.txt': 'found me' },
    },
    docs: { 'readme-copy.md': 'copy' },
  });
  volume = new DiskVolume();
  volume.attach(root);
});

describe('mounting', () => {
  it('reports the folder name for display', () => {
    expect(volume.mounted).toBe(true);
    expect(volume.label).toBe('my-project');
  });

  it('refuses to read anything once detached', async () => {
    volume.detach();
    expect(volume.mounted).toBe(false);
    await expect(volume.list('/')).rejects.toThrow(DiskError);
  });
});

describe('listing', () => {
  it('lists the root with folders first', async () => {
    const names = (await volume.list('/')).map((e) => e.name);
    expect(names).toEqual(['docs', 'src', 'notes.txt', 'photo.png', 'README.md']);
  });

  it('orders names case-insensitively, as the virtual filesystem does', async () => {
    volume.attach(fakeDirectory('case', { 'banana.txt': '', 'Apple.txt': '', 'cherry.txt': '' }));
    expect((await volume.list('/')).map((e) => e.name)).toEqual([
      'Apple.txt',
      'banana.txt',
      'cherry.txt',
    ]);
  });

  it('builds paths relative to the mount root', async () => {
    expect((await volume.list('/src')).map((e) => e.path)).toEqual([
      '/src/deep',
      '/src/helper.ts',
      '/src/main.ts',
    ]);
  });

  it('reads size and modified time from the real file', async () => {
    const readme = (await volume.list('/')).find((e) => e.name === 'README.md')!;
    expect(readme.size).toBe('# My Project\n\nHello.'.length);
    expect(readme.modifiedAt).toBeGreaterThan(0);
  });

  it('falls back to the extension when the platform reports no MIME type', async () => {
    const entries = await volume.list('/');
    expect(entries.find((e) => e.name === 'README.md')!.mime).toBe('text/markdown');
    expect(entries.find((e) => e.name === 'photo.png')!.mime).toBe('image/png');
  });

  it('descends several levels', async () => {
    expect((await volume.list('/src/deep')).map((e) => e.name)).toEqual(['buried.txt']);
  });

  it('reports a missing folder rather than returning nothing', async () => {
    await expect(volume.list('/nope')).rejects.toThrow(/No such folder/i);
  });
});

describe('reading', () => {
  it('reads file contents', async () => {
    expect(await volume.readText('/src/main.ts')).toBe('export const main = 1;');
  });

  it('reads through nested paths', async () => {
    expect(await volume.readText('/src/deep/buried.txt')).toBe('found me');
  });

  it('reports a missing file', async () => {
    await expect(volume.readText('/nope.txt')).rejects.toThrow(/No such file/i);
  });

  it('normalises traversal instead of escaping the mount', async () => {
    // '..' must resolve within the volume, never above the folder the user picked.
    expect(await volume.readText('/src/../notes.txt')).toBe('plain text');
    await expect(volume.readText('/../../etc/passwd')).rejects.toThrow(DiskError);
  });
});

describe('stat', () => {
  it('describes the mount root', async () => {
    expect(await volume.stat('/')).toMatchObject({ kind: 'folder', name: 'my-project' });
  });

  it('describes a file', async () => {
    expect(await volume.stat('/notes.txt')).toMatchObject({ kind: 'file', mime: 'text/plain' });
  });

  it('returns null for something that is not there', async () => {
    expect(await volume.stat('/ghost.txt')).toBeNull();
  });
});

describe('caching and reconciliation', () => {
  it('serves repeat listings from cache', async () => {
    await volume.list('/');
    root.put('late.txt', 'added outside Palm OS');
    // No invalidation yet, so the new file is not visible.
    expect((await volume.list('/')).some((e) => e.name === 'late.txt')).toBe(false);
  });

  it('picks up external changes after invalidation', async () => {
    await volume.list('/');
    root.put('late.txt', 'added outside Palm OS');
    volume.invalidate('/');
    expect((await volume.list('/')).some((e) => e.name === 'late.txt')).toBe(true);
  });

  it('notices external deletions', async () => {
    await volume.list('/');
    root.remove('notes.txt');
    volume.invalidate();
    expect((await volume.list('/')).some((e) => e.name === 'notes.txt')).toBe(false);
  });

  it('invalidating a folder also drops its descendants', async () => {
    await volume.list('/src');
    await volume.list('/src/deep');
    volume.invalidate('/src');
    // Both re-read cleanly rather than serving a stale child listing.
    expect((await volume.list('/src/deep')).map((e) => e.name)).toEqual(['buried.txt']);
  });
});

describe('search', () => {
  it('finds matches across the tree', async () => {
    const { results } = await volume.search('readme');
    expect(results.map((e) => e.name)).toEqual(['README.md', 'readme-copy.md']);
  });

  it('is case insensitive and matches mid-name', async () => {
    const { results } = await volume.search('HELP');
    expect(results.map((e) => e.name)).toEqual(['helper.ts']);
  });

  it('reaches nested folders', async () => {
    const { results } = await volume.search('buried');
    expect(results[0].path).toBe('/src/deep/buried.txt');
  });

  it('can be scoped to a subtree', async () => {
    const { results } = await volume.search('readme', { root: '/docs' });
    expect(results.map((e) => e.name)).toEqual(['readme-copy.md']);
  });

  it('ranks prefix matches first', async () => {
    const { results } = await volume.search('read');
    expect(results[0].name).toBe('README.md');
  });

  it('returns nothing for an empty query', async () => {
    expect((await volume.search('   ')).results).toHaveLength(0);
  });

  it('stops rather than hanging on a pathological tree', async () => {
    // A folder far wider than the search budget must still return promptly.
    const wide: Record<string, string> = {};
    for (let i = 0; i < 5000; i += 1) wide[`match-${i}.txt`] = 'x';
    volume.attach(fakeDirectory('huge', wide));
    const { results, truncated } = await volume.search('match');
    expect(truncated).toBe(true);
    expect(results.length).toBeLessThanOrEqual(200);
  });
});

describe('writing', () => {
  it('overwrites an existing file', async () => {
    await volume.writeFile('/notes.txt', 'replaced');
    expect(await volume.readText('/notes.txt')).toBe('replaced');
    expect(await root.contentsOf('notes.txt')).toBe('replaced');
  });

  it('writes into a nested folder', async () => {
    await volume.writeFile('/src/main.ts', 'export const main = 99;');
    expect(await volume.readText('/src/main.ts')).toBe('export const main = 99;');
  });

  it('refuses to create a file unless asked to', async () => {
    await expect(volume.writeFile('/brand-new.txt', 'x')).rejects.toThrow(/No such file/i);
  });

  it('creates a new file when asked', async () => {
    await volume.createFile('/brand-new.txt', 'hello');
    expect(await volume.readText('/brand-new.txt')).toBe('hello');
    expect((await volume.list('/')).some((e) => e.name === 'brand-new.txt')).toBe(true);
  });

  it('refuses to create over something that already exists', async () => {
    await expect(volume.createFile('/notes.txt')).rejects.toThrow(/already exists/i);
    await expect(volume.createFolder('/src')).rejects.toThrow(/already exists/i);
  });

  it('creates folders', async () => {
    await volume.createFolder('/generated');
    const entry = await volume.stat('/generated');
    expect(entry).toMatchObject({ kind: 'folder', name: 'generated' });
  });

  it('refreshes the listing after a write, without an explicit invalidate', async () => {
    await volume.list('/'); // prime the cache
    await volume.createFile('/appeared.txt', 'x');
    expect((await volume.list('/')).some((e) => e.name === 'appeared.txt')).toBe(true);
  });

  it('reports the new size after overwriting', async () => {
    await volume.writeFile('/notes.txt', 'a much longer body than before');
    const entry = await volume.stat('/notes.txt');
    expect(entry!.size).toBe('a much longer body than before'.length);
  });

  it('leaves the original intact when a write fails midway', async () => {
    // The platform writes to a swap file and only swaps on close, so an
    // aborted stream must not have touched the real file.
    const original = await volume.readText('/notes.txt');
    const handle = await volume.fileAt('/notes.txt');
    const stream = await handle.createWritable!();
    await stream.write('half-written garbage');
    await stream.abort!();
    expect(await volume.readText('/notes.txt')).toBe(original);
  });

  it('surfaces a refusal as a denial rather than a generic failure', async () => {
    const readOnly = fakeDirectory('locked', { 'a.txt': 'x' });
    // A handle with no createWritable is what a read-only grant looks like.
    const file = await readOnly.getFileHandle('a.txt');
    Object.defineProperty(file, 'createWritable', { value: undefined });
    volume.attach(readOnly);
    await expect(volume.writeFile('/a.txt', 'nope')).rejects.toThrow(/cannot write/i);
  });

  it('derives a non-colliding name for a new file', async () => {
    expect(await volume.uniqueName('/', 'notes.txt')).toBe('notes (2).txt');
    await volume.createFile('/notes (2).txt', '');
    expect(await volume.uniqueName('/', 'notes.txt')).toBe('notes (3).txt');
  });

  it('leaves a name alone when nothing collides', async () => {
    expect(await volume.uniqueName('/', 'fresh.txt')).toBe('fresh.txt');
  });

  /*
   * There is no Trash on someone's real disk, so removal is deliberately
   * absent from the volume rather than guarded by a confirmation.
   */
  it('offers no way to delete or rename', () => {
    const api = volume as unknown as Record<string, unknown>;
    expect(api.delete).toBeUndefined();
    expect(api.remove).toBeUndefined();
    expect(api.rename).toBeUndefined();
    expect(api.move).toBeUndefined();
  });
});
