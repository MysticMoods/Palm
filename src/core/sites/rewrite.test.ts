import { describe, expect, it } from 'vitest';
import {
  archivePath,
  cssReferences,
  localHref,
  resolveReference,
  rewriteCss,
  rewriteSrcset,
  scanScript,
  sourceUrlFor,
  srcsetEntries,
} from './rewrite';

const HOST = 'fixture.test';

describe('archivePath', () => {
  it('keeps the original path for the primary host', () => {
    // The whole point: a bundle that asks for /assets/main.js at runtime finds
    // it, without the archiver having predicted the request.
    expect(archivePath('https://fixture.test/assets/main.js', HOST)).toBe('/assets/main.js');
  });

  it('puts other hosts under /_ext/', () => {
    expect(archivePath('https://cdn.other.test/lib.js', HOST)).toBe('/_ext/cdn.other.test/lib.js');
  });

  it('keeps a port as part of the host label', () => {
    expect(archivePath('https://cdn.other.test:8443/lib.js', HOST)).toBe(
      '/_ext/cdn.other.test:8443/lib.js',
    );
  });

  it('names a directory index', () => {
    expect(archivePath('https://fixture.test/', HOST)).toBe('/index.html');
    expect(archivePath('https://fixture.test/docs/', HOST)).toBe('/docs/index.html');
  });

  it('gives distinct paths to the same file with different query strings', () => {
    const a = archivePath('https://fixture.test/render.png?size=2', HOST);
    const b = archivePath('https://fixture.test/render.png?size=4', HOST);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^\/render__[a-z0-9]+\.png$/);
  });

  it('is stable for the same query string', () => {
    expect(archivePath('https://fixture.test/a.js?v=1', HOST)).toBe(
      archivePath('https://fixture.test/a.js?v=1', HOST),
    );
  });

  it('appends the suffix when there is no extension to insert before', () => {
    expect(archivePath('https://fixture.test/render?size=2', HOST)).toMatch(/^\/render__[a-z0-9]+$/);
  });

  it('does not mistake a dot in a directory for an extension', () => {
    expect(archivePath('https://fixture.test/v1.2/page?x=1', HOST)).toMatch(
      /^\/v1\.2\/page__[a-z0-9]+$/,
    );
  });

  it('preserves percent-encoding exactly as the browser will request it', () => {
    // Decoding here and re-encoding at request time is how a Unicode path
    // turns into a 404 that is very hard to trace.
    expect(archivePath('https://fixture.test/café/logo.png', HOST)).toBe('/caf%C3%A9/logo.png');
    expect(archivePath('https://fixture.test/a%20b.png', HOST)).toBe('/a%20b.png');
    expect(archivePath('https://fixture.test/a b.png', HOST)).toBe('/a%20b.png');
  });

  it('collapses duplicate slashes', () => {
    expect(archivePath('https://fixture.test//assets//main.js', HOST)).toBe('/assets/main.js');
  });

  it('ignores the fragment, which is not part of the resource', () => {
    expect(archivePath('https://fixture.test/a.js#top', HOST)).toBe('/a.js');
  });
});

describe('sourceUrlFor', () => {
  it('round-trips a primary-host path', () => {
    expect(sourceUrlFor('/assets/main.js', HOST)).toBe('https://fixture.test/assets/main.js');
  });

  it('round-trips an external path', () => {
    expect(sourceUrlFor('/_ext/cdn.other.test/lib.js', HOST)).toBe('https://cdn.other.test/lib.js');
  });

  it('rejects anything that is not a rooted path', () => {
    expect(sourceUrlFor('assets/main.js', HOST)).toBeNull();
    expect(sourceUrlFor('/_ext/', HOST)).toBeNull();
  });
});

describe('resolveReference', () => {
  it('resolves relative, rooted and absolute references', () => {
    const base = 'https://fixture.test/docs/page.html';
    expect(resolveReference('../a.js', base)).toBe('https://fixture.test/a.js');
    expect(resolveReference('/b.js', base)).toBe('https://fixture.test/b.js');
    expect(resolveReference('https://other.test/c.js', base)).toBe('https://other.test/c.js');
  });

  it('resolves a protocol-relative reference against the base scheme', () => {
    expect(resolveReference('//cdn.test/x.js', 'https://fixture.test/')).toBe(
      'https://cdn.test/x.js',
    );
    expect(resolveReference('//cdn.test/x.js', 'http://fixture.test/')).toBe('http://cdn.test/x.js');
  });

  it('keeps query strings intact', () => {
    expect(resolveReference('/a.js?v=1&x=2', 'https://fixture.test/')).toBe(
      'https://fixture.test/a.js?v=1&x=2',
    );
  });

  it('drops the fragment', () => {
    expect(resolveReference('/a.js#x', 'https://fixture.test/')).toBe('https://fixture.test/a.js');
  });

  it('leaves non-network references alone', () => {
    for (const reference of [
      'data:image/png;base64,AAA',
      'blob:https://x/y',
      'javascript:void 0',
      'mailto:a@b.test',
      'tel:+1',
      'about:blank',
      '#section',
      '',
      '   ',
    ]) {
      expect(resolveReference(reference, 'https://fixture.test/')).toBeNull();
    }
  });

  it('rejects a scheme it cannot fetch', () => {
    expect(resolveReference('ftp://x.test/a', 'https://fixture.test/')).toBeNull();
  });
});

describe('localHref', () => {
  it('rewrites to an app-origin path', () => {
    expect(localHref('/assets/main.js', 'https://fixture.test/', HOST)).toBe('/assets/main.js');
  });

  it('keeps an in-page fragment on the rewritten path', () => {
    expect(localHref('/docs/page.html#install', 'https://fixture.test/', HOST)).toBe(
      '/docs/page.html#install',
    );
  });

  it('returns null for references that should be left as they are', () => {
    expect(localHref('#top', 'https://fixture.test/', HOST)).toBeNull();
    expect(localHref('data:,x', 'https://fixture.test/', HOST)).toBeNull();
  });
});

describe('cssReferences', () => {
  it('finds url() and @import', () => {
    const css = `@import "base.css"; .a { background: url('img/a.png'); } .b { background: url(img/b.png) }`;
    expect(cssReferences(css, 'https://fixture.test/styles/app.css').sort()).toEqual([
      'https://fixture.test/styles/base.css',
      'https://fixture.test/styles/img/a.png',
      'https://fixture.test/styles/img/b.png',
    ]);
  });

  it('skips data URIs', () => {
    expect(cssReferences(`.a { background: url(data:image/gif;base64,AA) }`, 'https://fixture.test/')).toEqual([]);
  });
});

describe('rewriteCss', () => {
  it('rewrites references and leaves the rest of the stylesheet alone', () => {
    const css = `@import "base.css";\n.page { background: url(../img/bg.png); color: red }`;
    const out = rewriteCss(css, 'https://fixture.test/styles/app.css', HOST);
    expect(out).toContain('/styles/base.css');
    expect(out).toContain('/img/bg.png');
    expect(out).toContain('color: red');
  });

  it('sends a third-party font to /_ext/', () => {
    const out = rewriteCss(
      `@font-face { src: url(https://fonts.test/a.woff2) }`,
      'https://fixture.test/a.css',
      HOST,
    );
    expect(out).toContain('/_ext/fonts.test/a.woff2');
  });

  it('preserves the original quote style', () => {
    expect(rewriteCss(`.a{background:url("x.png")}`, 'https://fixture.test/', HOST)).toContain(
      'url("/x.png")',
    );
    expect(rewriteCss(`.a{background:url(x.png)}`, 'https://fixture.test/', HOST)).toContain(
      'url(/x.png)',
    );
  });
});

describe('srcset', () => {
  it('parses urls and descriptors', () => {
    expect(srcsetEntries('a.png 1x, b.png 2x')).toEqual([
      { url: 'a.png', descriptor: '1x' },
      { url: 'b.png', descriptor: '2x' },
    ]);
  });

  it('handles an entry with no descriptor', () => {
    expect(srcsetEntries('a.png')).toEqual([{ url: 'a.png', descriptor: '' }]);
  });

  it('rewrites every candidate and reports them', () => {
    const result = rewriteSrcset('img/a.png 1x, img/b.png 2x', 'https://fixture.test/', HOST);
    expect(result.value).toBe('/img/a.png 1x, /img/b.png 2x');
    expect(result.references).toEqual([
      'https://fixture.test/img/a.png',
      'https://fixture.test/img/b.png',
    ]);
  });
});

describe('scanScript', () => {
  const base = 'https://fixture.test/assets/main.js';

  it('finds asset literals it can resolve', () => {
    const source = `const a = "./chunk-a1.js"; const b = "/assets/style.css"; loadWasm("https://cdn.test/x.wasm");`;
    expect(scanScript(source, base).references.sort()).toEqual([
      'https://cdn.test/x.wasm',
      'https://fixture.test/assets/chunk-a1.js',
      'https://fixture.test/assets/style.css',
    ]);
  });

  it('ignores ordinary strings that are not resources', () => {
    expect(scanScript(`const greeting = "hello world"; const v = "1.2.3";`, base).references).toEqual(
      [],
    );
  });

  it('reports WebSocket endpoints, which no archive can stand in for', () => {
    const scan = scanScript(`const s = new WebSocket("wss://live.test/socket");`, base);
    expect(scan.websockets).toEqual(['wss://live.test/socket']);
  });

  it('finds a WebSocket URL held in a variable', () => {
    expect(scanScript(`const url = "wss://live.test/x"; connect(url);`, base).websockets).toEqual([
      'wss://live.test/x',
    ]);
  });

  it('reports backend API paths', () => {
    const scan = scanScript(`fetch("/api/documents"); post("/v1/save");`, base);
    expect(scan.backendHints.sort()).toEqual(['/api/documents', '/v1/save']);
  });

  it('counts constructs it cannot follow rather than ignoring them', () => {
    // These are the reason an archive's status stays provisional until the
    // application has actually been run once.
    const scan = scanScript(
      `import("./late.js"); import("./later.js"); new Worker(u); new SharedWorker(v);`,
      base,
    );
    expect(scan.dynamicImports).toBe(2);
    expect(scan.workers).toBe(2);
  });

  it('notices WebAssembly and service-worker registration', () => {
    const scan = scanScript(
      `WebAssembly.instantiateStreaming(f); navigator.serviceWorker.register("/sw.js");`,
      base,
    );
    expect(scan.wasm).toBe(true);
    expect(scan.serviceWorker).toBe(true);
  });

  it('does not execute anything it reads', () => {
    // A scanner that evaluated its input would be the exact hole this design
    // exists to avoid; the assertion is that a hostile literal is just text.
    const hostile = `globalThis.__pwned = true; const x = "./a.js";`;
    const scan = scanScript(hostile, base);
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
    expect(scan.references).toEqual(['https://fixture.test/assets/a.js']);
  });

  it('survives a very large bundle without hanging', () => {
    const big = `const x = "./a.js";`.repeat(200_000);
    const scan = scanScript(big, base);
    expect(scan.references).toEqual(['https://fixture.test/assets/a.js']);
  });
});
