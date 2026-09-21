import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { seedFilesystem } from './seed';
import { FSError } from './types';
import { ROOT_ID, vfs } from './vfs';

/** A fresh, seeded filesystem before every test. */
beforeEach(async () => {
  await vfs.init();
  await seedFilesystem();
});

const at = (path: string) => vfs.requireNode(path);

describe('seeding', () => {
  it('creates the standard home folders', () => {
    for (const name of ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos']) {
      expect(vfs.exists(`/${name}`)).toBe(true);
    }
  });

  it('marks them as system folders', () => {
    expect(at('/Documents').system).toBe(true);
  });

  it('resolves paths back from ids', () => {
    expect(vfs.pathOf(at('/Documents/Projects').id)).toBe('/Documents/Projects');
    expect(vfs.pathOf(ROOT_ID)).toBe('/');
  });
});

describe('creating', () => {
  it('creates folders and files', async () => {
    const docs = at('/Documents');
    await vfs.createFolder(docs.id, 'Work');
    await vfs.createFile(docs.id, 'a.txt', 'hello');
    expect(vfs.exists('/Documents/Work')).toBe(true);
    expect(await vfs.readText(at('/Documents/a.txt').id)).toBe('hello');
  });

  it('refuses a duplicate name in the same folder', async () => {
    const docs = at('/Documents');
    await vfs.createFolder(docs.id, 'Work');
    await expect(vfs.createFolder(docs.id, 'Work')).rejects.toThrow(FSError);
  });

  it('treats names case-insensitively when checking collisions', async () => {
    const docs = at('/Documents');
    await vfs.createFolder(docs.id, 'Work');
    await expect(vfs.createFolder(docs.id, 'WORK')).rejects.toThrow(/already exists/i);
  });

  it('rejects names containing a separator', async () => {
    await expect(vfs.createFolder(at('/Documents').id, 'a/b')).rejects.toThrow(/not a valid name/i);
  });

  it('derives a unique name on request', async () => {
    const docs = at('/Documents');
    await vfs.createFile(docs.id, 'note.txt', '');
    expect(vfs.uniqueName(docs.id, 'note.txt')).toBe('note (2).txt');
    await vfs.createFile(docs.id, 'note (2).txt', '');
    expect(vfs.uniqueName(docs.id, 'note.txt')).toBe('note (3).txt');
  });

  it('mkdirp creates the whole chain', async () => {
    await vfs.mkdirp('/Documents/a/b/c');
    expect(vfs.exists('/Documents/a/b/c')).toBe(true);
  });

  it('writeFile creates parents when asked', async () => {
    await vfs.writeFile('/Documents/deep/nested/file.txt', 'x', { recursive: true });
    expect(await vfs.readText(at('/Documents/deep/nested/file.txt').id)).toBe('x');
  });

  it('writeFile overwrites an existing file rather than duplicating it', async () => {
    await vfs.writeFile('/Documents/x.txt', 'first', { recursive: true });
    await vfs.writeFile('/Documents/x.txt', 'second', { recursive: true });
    expect(await vfs.readText(at('/Documents/x.txt').id)).toBe('second');
    expect(vfs.list(at('/Documents').id).filter((n) => n.name === 'x.txt')).toHaveLength(1);
  });

  it('records byte length, not character count', async () => {
    await vfs.writeFile('/Documents/u.txt', 'héllo', { recursive: true });
    expect(at('/Documents/u.txt').size).toBe(6); // é is two bytes in UTF-8
  });
});

describe('renaming and moving', () => {
  it('renames a file and updates its MIME type', async () => {
    await vfs.writeFile('/Documents/a.txt', 'x', { recursive: true });
    await vfs.rename(at('/Documents/a.txt').id, 'a.json');
    expect(at('/Documents/a.json').mime).toBe('application/json');
  });

  it('refuses to rename a system folder', async () => {
    await expect(vfs.rename(at('/Documents').id, 'Docs')).rejects.toThrow(/system folder/i);
  });

  it('moves a file between folders', async () => {
    await vfs.writeFile('/Documents/a.txt', 'x', { recursive: true });
    await vfs.move(at('/Documents/a.txt').id, at('/Downloads').id);
    expect(vfs.exists('/Downloads/a.txt')).toBe(true);
    expect(vfs.exists('/Documents/a.txt')).toBe(false);
  });

  it('renames on collision rather than overwriting', async () => {
    await vfs.writeFile('/Documents/a.txt', 'one', { recursive: true });
    await vfs.writeFile('/Downloads/a.txt', 'two', { recursive: true });
    await vfs.move(at('/Documents/a.txt').id, at('/Downloads').id);
    expect(await vfs.readText(at('/Downloads/a.txt').id)).toBe('two');
    expect(vfs.exists('/Downloads/a (2).txt')).toBe(true);
  });

  it('refuses to move a folder inside itself', async () => {
    await vfs.mkdirp('/Documents/outer/inner');
    const outer = at('/Documents/outer');
    await expect(vfs.move(outer.id, at('/Documents/outer/inner').id)).rejects.toThrow(FSError);
    await expect(vfs.move(outer.id, outer.id)).rejects.toThrow(FSError);
  });
});

describe('copying', () => {
  it('copies a file with its contents', async () => {
    await vfs.writeFile('/Documents/a.txt', 'payload', { recursive: true });
    await vfs.copy(at('/Documents/a.txt').id, at('/Downloads').id);
    expect(await vfs.readText(at('/Downloads/a.txt').id)).toBe('payload');
  });

  it('copies a folder tree recursively', async () => {
    await vfs.writeFile('/Documents/tree/a/b.txt', 'deep', { recursive: true });
    await vfs.copy(at('/Documents/tree').id, at('/Downloads').id);
    expect(await vfs.readText(at('/Downloads/tree/a/b.txt').id)).toBe('deep');
  });

  it('duplicates alongside the original', async () => {
    await vfs.writeFile('/Documents/a.txt', 'x', { recursive: true });
    await vfs.duplicate(at('/Documents/a.txt').id);
    expect(vfs.exists('/Documents/a copy.txt')).toBe(true);
    expect(vfs.exists('/Documents/a.txt')).toBe(true);
  });

  it('refuses to copy a folder into itself', async () => {
    await vfs.mkdirp('/Documents/self');
    const self = at('/Documents/self');
    await expect(vfs.copy(self.id, self.id)).rejects.toThrow(FSError);
  });
});

describe('trash', () => {
  it('hides a trashed item from its folder but keeps the data', async () => {
    await vfs.writeFile('/Documents/a.txt', 'keep me', { recursive: true });
    const id = at('/Documents/a.txt').id;
    await vfs.moveToTrash(id);
    expect(vfs.exists('/Documents/a.txt')).toBe(false);
    expect(await vfs.readText(id)).toBe('keep me');
  });

  it('lists only the top-level trashed items', async () => {
    await vfs.writeFile('/Documents/box/a.txt', 'x', { recursive: true });
    await vfs.moveToTrash(at('/Documents/box').id);
    expect(vfs.listTrash().map((n) => n.name)).toEqual(['box']);
  });

  it('restores to the original folder', async () => {
    await vfs.writeFile('/Documents/a.txt', 'x', { recursive: true });
    const id = at('/Documents/a.txt').id;
    await vfs.moveToTrash(id);
    await vfs.restoreFromTrash(id);
    expect(vfs.exists('/Documents/a.txt')).toBe(true);
    expect(vfs.listTrash()).toHaveLength(0);
  });

  it('restores under a new name when the original is taken', async () => {
    await vfs.writeFile('/Documents/a.txt', 'first', { recursive: true });
    const id = at('/Documents/a.txt').id;
    await vfs.moveToTrash(id);
    await vfs.writeFile('/Documents/a.txt', 'replacement', { recursive: true });
    await vfs.restoreFromTrash(id);
    expect(await vfs.readText(at('/Documents/a.txt').id)).toBe('replacement');
    expect(vfs.exists('/Documents/a (2).txt')).toBe(true);
  });

  it('takes trashed contents with it when a folder is deleted permanently', async () => {
    // Trashing flags a node in place rather than relocating it, so a trashed
    // file is still a child of its folder. `rm -f` on that folder is a request
    // to remove everything under it, trashed or not.
    await vfs.writeFile('/Documents/gone/a.txt', 'x', { recursive: true });
    const fileId = at('/Documents/gone/a.txt').id;
    await vfs.moveToTrash(fileId);
    expect(vfs.listTrash()).toHaveLength(1);

    await vfs.deletePermanently(at('/Documents/gone').id);
    expect(vfs.getNode(fileId)).toBeUndefined();
    expect(vfs.listTrash()).toHaveLength(0);
  });

  it('falls back to the Desktop when the original folder is itself trashed', async () => {
    await vfs.writeFile('/Documents/box/a.txt', 'x', { recursive: true });
    const fileId = at('/Documents/box/a.txt').id;
    await vfs.moveToTrash(fileId);
    await vfs.moveToTrash(at('/Documents/box').id);

    // Nested items are hidden from the Trash listing, but restoring one
    // directly must still land somewhere sensible rather than throwing.
    await vfs.restoreFromTrash(fileId);
    expect(vfs.exists('/Desktop/a.txt')).toBe(true);
  });

  it('refuses to trash a system folder', async () => {
    await expect(vfs.moveToTrash(at('/Documents').id)).rejects.toThrow(/system folder/i);
  });

  it('emptying the trash removes descendants too', async () => {
    await vfs.writeFile('/Documents/box/a.txt', 'x', { recursive: true });
    const fileId = at('/Documents/box/a.txt').id;
    await vfs.moveToTrash(at('/Documents/box').id);
    const removed = await vfs.emptyTrash();
    expect(removed).toBe(1);
    expect(vfs.getNode(fileId)).toBeUndefined();
    expect(vfs.listTrash()).toHaveLength(0);
  });
});

describe('search and stats', () => {
  it('ranks prefix matches above mid-word matches', async () => {
    await vfs.writeFile('/Documents/report.txt', '', { recursive: true });
    await vfs.writeFile('/Documents/annual-report.txt', '', { recursive: true });
    expect(vfs.search('report')[0].name).toBe('report.txt');
  });

  it('is case insensitive', async () => {
    await vfs.writeFile('/Documents/Report.txt', '', { recursive: true });
    expect(vfs.search('report').some((n) => n.name === 'Report.txt')).toBe(true);
  });

  it('excludes trashed items', async () => {
    await vfs.writeFile('/Documents/secret.txt', '', { recursive: true });
    await vfs.moveToTrash(at('/Documents/secret.txt').id);
    expect(vfs.search('secret')).toHaveLength(0);
  });

  it('can be scoped to a subtree', async () => {
    await vfs.writeFile('/Documents/scoped.txt', '', { recursive: true });
    await vfs.writeFile('/Downloads/scoped.txt', '', { recursive: true });
    expect(vfs.search('scoped', { root: '/Downloads' })).toHaveLength(1);
  });

  it('sums folder sizes recursively', async () => {
    await vfs.writeFile('/Documents/sized/a.txt', 'abcde', { recursive: true });
    await vfs.writeFile('/Documents/sized/b/c.txt', 'fgh', { recursive: true });
    expect(vfs.sizeOf(at('/Documents/sized').id)).toBe(8);
    expect(vfs.countWithin(at('/Documents/sized').id)).toEqual({ files: 2, folders: 1 });
  });
});

describe('errors', () => {
  it('reports a missing path with ENOENT', () => {
    expect(() => vfs.requireNode('/nope')).toThrow(FSError);
    try {
      vfs.requireNode('/nope');
    } catch (error) {
      expect((error as FSError).code).toBe('ENOENT');
    }
  });

  it('refuses to list a file', async () => {
    await vfs.writeFile('/Documents/a.txt', '', { recursive: true });
    expect(() => vfs.list(at('/Documents/a.txt').id)).toThrow(/not a folder/i);
  });

  it('refuses to read a folder as a file', async () => {
    await expect(vfs.readFile('/Documents')).rejects.toThrow(/is a folder/i);
  });
});
