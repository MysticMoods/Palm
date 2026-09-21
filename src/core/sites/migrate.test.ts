import { describe, expect, it } from 'vitest';
import { migratePath, migrateReferences, prepareMigration } from './migrate';
import type { LegacySiteFile, LegacySitePackage } from './storage';
import { ARCHIVE_STATUS } from './types';

const HOST = 'fixture.test';

describe('migratePath', () => {
  it('lifts the primary host to the root of the application origin', () => {
    expect(migratePath('fixture.test/assets/main.js', HOST)).toBe('/assets/main.js');
    expect(migratePath('fixture.test/index.html', HOST)).toBe('/index.html');
  });

  it('files another host under /_ext/', () => {
    expect(migratePath('cdn.other.test/lib.js', HOST)).toBe('/_ext/cdn.other.test/lib.js');
  });

  it('tolerates a leading slash from either layout', () => {
    expect(migratePath('/fixture.test/a.js', HOST)).toBe('/a.js');
  });

  it('gives a bare host an index document', () => {
    expect(migratePath('fixture.test', HOST)).toBe('/index.html');
  });
});

describe('migrateReferences', () => {
  it('repoints the old scope prefix baked into a document', () => {
    // Moving the files without moving the references would produce an
    // application whose every link pointed at a path that no longer exists.
    const html = `<link href="/site/site_a1/fixture.test/styles/app.css"><script src="/site/site_a1/fixture.test/app.js"></script>`;
    const out = migrateReferences(html, 'site_a1', HOST);
    expect(out).toContain('href="/styles/app.css"');
    expect(out).toContain('src="/app.js"');
    expect(out).not.toContain('/site/');
  });

  it('repoints third-party references into /_ext/', () => {
    const css = `@import url(/site/site_a1/fonts.test/a.css);`;
    expect(migrateReferences(css, 'site_a1', HOST)).toContain('/_ext/fonts.test/a.css');
  });

  it('leaves another application’s prefix alone', () => {
    const html = `<img src="/site/site_other/fixture.test/a.png">`;
    expect(migrateReferences(html, 'site_a1', HOST)).toBe(html);
  });

  it('treats a regex-special id literally', () => {
    const html = `<img src="/site/a.b+c/fixture.test/a.png">`;
    expect(migrateReferences(html, 'a.b+c', HOST)).toContain('src="/a.png"');
  });
});

describe('prepareMigration', () => {
  const legacy = (): LegacySitePackage => ({
    id: 'site_a1',
    name: 'Fixture Notepad',
    url: 'https://fixture.test/',
    host: HOST,
    entry: 'fixture.test/index.html',
    icon: 'Globe',
    color: '#38b6f0',
    installedAt: 1000,
    updatedAt: 1000,
    bytes: 200,
    fileCount: 2,
    missing: [],
  });

  const files = (): LegacySiteFile[] => [
    {
      key: 'site_a1/fixture.test/index.html',
      siteId: 'site_a1',
      path: 'fixture.test/index.html',
      mime: 'text/html',
      data: new Blob(
        ['<html><head><link href="/site/site_a1/fixture.test/app.css"></head></html>'],
        { type: 'text/html' },
      ),
    },
    {
      key: 'site_a1/fixture.test/app.css',
      siteId: 'site_a1',
      path: 'fixture.test/app.css',
      mime: 'text/css',
      data: new Blob(['body{background:url(/site/site_a1/fixture.test/bg.png)}'], {
        type: 'text/css',
      }),
    },
  ];

  it('produces a manifest on a fresh isolated-origin id', async () => {
    const result = await prepareMigration(legacy(), files());
    expect(result.manifest.id).toMatch(/^app-[0-9a-f]{12}$/);
    expect(result.manifest.name).toBe('Fixture Notepad');
    expect(result.manifest.entry).toBe('/index.html');
    expect(result.manifest.archiveVersion).toBe(2);
  });

  it('keeps the original install date, because it is still the same install', async () => {
    const result = await prepareMigration(legacy(), files());
    expect(result.manifest.createdAt).toBe(1000);
  });

  it('re-paths every file into the new layout', async () => {
    const result = await prepareMigration(legacy(), files());
    expect(result.files.map((file) => file.path).sort()).toEqual(['/app.css', '/index.html']);
  });

  it('rewrites references inside the migrated documents', async () => {
    const result = await prepareMigration(legacy(), files());
    const html = await result.files.find((file) => file.path === '/index.html')!.data.text();
    const css = await result.files.find((file) => file.path === '/app.css')!.data.text();
    expect(html).toContain('href="/app.css"');
    expect(css).toContain('url(/bg.png)');
    expect(html).not.toContain('/site/');
  });

  it('grants nothing, whatever the old install could reach', async () => {
    // The point of migrating is that these applications stop having the OS's
    // access; arriving with permissions would undo that.
    const result = await prepareMigration(legacy(), files());
    expect(result.manifest.permissions).toEqual(['STORAGE']);
  });

  it('carries missing resources across as a partial archive', async () => {
    const result = await prepareMigration(
      { ...legacy(), missing: ['https://fixture.test/late.js'] },
      files(),
    );
    expect(result.manifest.status).toBe(ARCHIVE_STATUS.partial);
    expect(result.manifest.missingResources).toEqual([
      { url: 'https://fixture.test/late.js', reason: 'not-archived' },
    ]);
  });

  it('marks an archive with no entry document as failed', async () => {
    const result = await prepareMigration({ ...legacy(), entry: 'fixture.test/gone.html' }, files());
    expect(result.manifest.status).toBe(ARCHIVE_STATUS.failed);
  });
});
