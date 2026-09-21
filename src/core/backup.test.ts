import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, validateBackup } from './backup';
import type { FSNode } from './filesystem/types';

const node = (over: Partial<FSNode>): FSNode => ({
  id: 'x',
  name: 'x',
  parentId: 'root',
  kind: 'file',
  mime: 'text/plain',
  size: 0,
  createdAt: 0,
  modifiedAt: 0,
  trash: null,
  ...over,
});

const root = node({ id: 'root', name: '', parentId: null, kind: 'folder', mime: 'inode/directory' });

const backup = (nodes: FSNode[]) => ({
  format: BACKUP_FORMAT,
  version: 1,
  osVersion: '1.0.0',
  createdAt: Date.now(),
  nodes,
  contents: [],
  kv: [],
});

describe('validateBackup', () => {
  it('accepts a well-formed backup', () => {
    const result = validateBackup(backup([root, node({ id: 'a', name: 'a.txt' })]));
    expect(result.valid).toBe(true);
    expect(result.summary).toMatchObject({ files: 1, folders: 0 });
  });

  it('rejects something that is not an object', () => {
    expect(validateBackup('nope').valid).toBe(false);
    expect(validateBackup(null).valid).toBe(false);
    expect(validateBackup([]).valid).toBe(false);
  });

  it('rejects a file from another application', () => {
    const result = validateBackup({ format: 'some-other-app', version: 1 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/not a Palm OS backup/i);
  });

  it('rejects a backup from a newer version it cannot read', () => {
    const result = validateBackup({ ...backup([root]), version: 99 });
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/newer/i);
  });

  it('rejects malformed node records', () => {
    const result = validateBackup(backup([root, { id: 'bad' } as unknown as FSNode]));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toMatch(/malformed/i);
  });

  it('rejects duplicate ids', () => {
    const result = validateBackup(backup([root, node({ id: 'a' }), node({ id: 'a' })]));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/duplicate/i);
  });

  it('rejects a backup with no root', () => {
    const result = validateBackup(backup([node({ id: 'a' })]));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/root|parent folder/i);
  });

  it('rejects a node whose parent is missing', () => {
    const result = validateBackup(backup([root, node({ id: 'a', parentId: 'ghost' })]));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/parent folder that is not in the backup/i);
  });

  /*
   * A cycle would hang path resolution, which walks parent links to the root.
   * It has to be rejected before anything is written.
   */
  it('rejects a folder loop', () => {
    const result = validateBackup(
      backup([
        root,
        node({ id: 'a', parentId: 'b', kind: 'folder' }),
        node({ id: 'b', parentId: 'a', kind: 'folder' }),
      ]),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/loop/i);
  });

  it('rejects a node that is its own parent', () => {
    const result = validateBackup(backup([root, node({ id: 'a', parentId: 'a', kind: 'folder' })]));
    expect(result.valid).toBe(false);
  });

  it('counts folders excluding the root', () => {
    const result = validateBackup(
      backup([root, node({ id: 'f', kind: 'folder', mime: 'inode/directory' }), node({ id: 'a' })]),
    );
    expect(result.summary).toMatchObject({ files: 1, folders: 1 });
  });
});
