/** Extension ↔ MIME mapping and the file-category vocabulary used by the UI. */

import { extname } from './path';

export const FOLDER_MIME = 'inode/directory';

const BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  log: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  xml: 'application/xml',
  yml: 'text/yaml',
  yaml: 'text/yaml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  jsx: 'text/javascript',
  py: 'text/x-python',
  rs: 'text/x-rust',
  go: 'text/x-go',
  sh: 'text/x-shellscript',
  c: 'text/x-c',
  h: 'text/x-c',
  cpp: 'text/x-c++',
  java: 'text/x-java',
  sql: 'text/x-sql',
  toml: 'text/x-toml',
  ini: 'text/plain',
  conf: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  pdf: 'application/pdf',
  zip: 'application/zip',
  gz: 'application/gzip',
  tar: 'application/x-tar',
  note: 'application/x-palm-note',
};

export function mimeFromName(name: string): string {
  return BY_EXTENSION[extname(name)] ?? 'application/octet-stream';
}

export function extensionForMime(mime: string): string | undefined {
  for (const [ext, value] of Object.entries(BY_EXTENSION)) {
    if (value === mime) return ext;
  }
  return undefined;
}

export type FileCategory =
  | 'folder'
  | 'text'
  | 'code'
  | 'image'
  | 'audio'
  | 'video'
  | 'archive'
  | 'document'
  | 'binary';

const CODE_MIMES = new Set([
  'text/javascript',
  'text/typescript',
  'text/css',
  'text/html',
  'text/x-python',
  'text/x-rust',
  'text/x-go',
  'text/x-shellscript',
  'text/x-c',
  'text/x-c++',
  'text/x-java',
  'text/x-sql',
  'text/x-toml',
  'application/json',
  'application/xml',
  'text/yaml',
]);

export function categoryForMime(mime: string): FileCategory {
  if (mime === FOLDER_MIME) return 'folder';
  if (CODE_MIMES.has(mime)) return 'code';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('text/')) return 'text';
  if (mime === 'application/pdf') return 'document';
  if (mime === 'application/zip' || mime === 'application/gzip' || mime === 'application/x-tar')
    return 'archive';
  if (mime === 'application/x-palm-note') return 'text';
  return 'binary';
}

/** Whether the payload can be safely shown in a text editor. */
export function isTextMime(mime: string): boolean {
  const category = categoryForMime(mime);
  return category === 'text' || category === 'code';
}

/** Friendly type label for the Files "Type" column and Properties dialog. */
export function describeMime(mime: string): string {
  if (mime === FOLDER_MIME) return 'Folder';
  const labels: Record<string, string> = {
    'text/plain': 'Plain text',
    'text/markdown': 'Markdown document',
    'application/json': 'JSON document',
    'text/csv': 'CSV spreadsheet',
    'text/html': 'HTML document',
    'application/pdf': 'PDF document',
    'application/x-palm-note': 'Palm note',
    'application/octet-stream': 'Binary file',
  };
  if (labels[mime]) return labels[mime];
  const category = categoryForMime(mime);
  const subtype = mime.split('/')[1]?.toUpperCase() ?? 'File';
  switch (category) {
    case 'image':
      return `${subtype} image`;
    case 'audio':
      return `${subtype} audio`;
    case 'video':
      return `${subtype} video`;
    case 'code':
      return `${subtype} source`;
    case 'archive':
      return `${subtype} archive`;
    default:
      return `${subtype} file`;
  }
}
