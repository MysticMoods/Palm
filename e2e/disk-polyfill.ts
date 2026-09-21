/**
 * An in-memory `showDirectoryPicker`.
 *
 * The File System Access API is Chromium-only and its picker cannot be driven
 * from a test at all, so Palm Disk would otherwise be unexercisable end to
 * end. Installing a handle that satisfies the same interface lets the real
 * code path — mount, permission escalation, listing, read, write — run
 * unchanged against a folder we control.
 */
export const DISK_POLYFILL = `
(() => {
  const CLOCK = 1700000000000;
  window.__grants = [];
  const perms = {
    async queryPermission({ mode }) { return mode === 'readwrite' ? 'prompt' : 'granted'; },
    async requestPermission({ mode }) { window.__grants.push(mode); return 'granted'; },
  };
  const makeFile = (name, initial) => {
    let body = initial;
    return {
      kind: 'file', name,
      async getFile() { return new File([body], name, { lastModified: CLOCK }); },
      async createWritable() {
        let pending = '';
        return {
          async write(d) { pending += typeof d === 'string' ? d : await d.text(); },
          async close() { body = pending; },
          async abort() { pending = ''; },
        };
      },
      get __body() { return body; },
    };
  };
  const makeDir = (name, tree) => {
    const children = new Map();
    for (const [k, v] of Object.entries(tree)) {
      children.set(k, typeof v === 'string' ? makeFile(k, v) : makeDir(k, v));
    }
    const handle = {
      kind: 'directory', name, ...perms,
      async *entries() { for (const e of children) yield e; },
      async getDirectoryHandle(n, o) {
        let c = children.get(n);
        if (!c && o && o.create) { c = makeDir(n, {}); children.set(n, c); }
        if (!c || c.kind !== 'directory') throw new Error('NotFoundError');
        return c;
      },
      async getFileHandle(n, o) {
        let c = children.get(n);
        if (!c && o && o.create) { c = makeFile(n, ''); children.set(n, c); }
        if (!c || c.kind !== 'file') throw new Error('NotFoundError');
        return c;
      },
    };
    if (name === 'my-project') {
      // Hooks for simulating edits made outside the browser.
      window.__peek = (n) => children.get(n)?.__body ?? null;
      window.__add = (n, c) => children.set(n, makeFile(n, c));
      window.__drop = (n) => children.delete(n);
    }
    return handle;
  };
  window.showDirectoryPicker = async () => makeDir('my-project', {
    'notes.txt': 'original contents',
    'README.md': '# My Project',
    src: { 'main.ts': 'export const main = 1;' },
  });
})();
`;
