import { describe, expect, it } from 'vitest';
import { categoryForMime, describeMime, isTextMime, mimeFromName } from './mime';

describe('mimeFromName', () => {
  it('maps common extensions', () => {
    expect(mimeFromName('a.txt')).toBe('text/plain');
    expect(mimeFromName('a.json')).toBe('application/json');
    expect(mimeFromName('a.png')).toBe('image/png');
    expect(mimeFromName('a.mp4')).toBe('video/mp4');
  });

  it('ignores case', () => {
    expect(mimeFromName('PHOTO.JPG')).toBe('image/jpeg');
  });

  it('falls back for unknown and missing extensions', () => {
    expect(mimeFromName('a.wat')).toBe('application/octet-stream');
    expect(mimeFromName('README')).toBe('application/octet-stream');
  });
});

describe('categoryForMime', () => {
  it('groups by family', () => {
    expect(categoryForMime('inode/directory')).toBe('folder');
    expect(categoryForMime('image/png')).toBe('image');
    expect(categoryForMime('audio/mpeg')).toBe('audio');
    expect(categoryForMime('video/mp4')).toBe('video');
    expect(categoryForMime('text/plain')).toBe('text');
    expect(categoryForMime('application/pdf')).toBe('document');
    expect(categoryForMime('application/zip')).toBe('archive');
  });

  it('separates source files from prose', () => {
    expect(categoryForMime('text/typescript')).toBe('code');
    expect(categoryForMime('application/json')).toBe('code');
    expect(categoryForMime('text/markdown')).toBe('text');
  });

  it('treats anything unrecognised as binary', () => {
    expect(categoryForMime('application/octet-stream')).toBe('binary');
  });
});

describe('isTextMime', () => {
  it('allows text and source into the editor', () => {
    expect(isTextMime('text/plain')).toBe(true);
    expect(isTextMime('application/json')).toBe(true);
  });

  it('keeps binary out of the editor', () => {
    // Opening these as text would show the user meaningless characters.
    expect(isTextMime('image/png')).toBe(false);
    expect(isTextMime('application/pdf')).toBe(false);
    expect(isTextMime('application/octet-stream')).toBe(false);
  });
});

describe('describeMime', () => {
  it('names known types in plain language', () => {
    expect(describeMime('inode/directory')).toBe('Folder');
    expect(describeMime('text/markdown')).toBe('Markdown document');
  });

  it('derives a readable label for anything else', () => {
    expect(describeMime('image/webp')).toBe('WEBP image');
    expect(describeMime('audio/flac')).toBe('FLAC audio');
  });
});
