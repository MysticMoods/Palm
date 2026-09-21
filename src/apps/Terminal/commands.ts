/**
 * Terminal commands.
 *
 * Every command here operates on the Palm OS *virtual* filesystem. The shell
 * is a simulation running inside a web page: it has no access to the host
 * machine's disk, processes or network stack, and says so plainly rather than
 * pretending otherwise.
 */

import { OS_CODENAME, OS_NAME, OS_VERSION } from '../../core/settings/defaults';
import { launchableApps } from '../../core/app-manager/registry';
import { describeMime, isTextMime } from '../../core/filesystem/mime';
import * as path from '../../core/filesystem/path';
import { FSError, vfs } from '../../core/filesystem/vfs';
import type { FSNode } from '../../core/filesystem/types';
import { estimateStorage } from '../../core/storage/db';
import { getProfile, getSettings } from '../../core/settings/store';
import { OS } from '../../core/os';
import { siteAppId, useSitesStore } from '../../core/sites/store';
import { statusLabel, statusSummary } from '../../core/sites/manifest';
import { appOrigin } from '../../core/sites/origin';
import { useWindowStore } from '../../core/window-manager/store';
import { formatBytes, formatDate } from '../../utils/format';
import { parseFlags } from './parser';

export interface CommandContext {
  cwd: string;
  args: string[];
  /** Piped input, or '' when the command starts a pipeline. */
  stdin: string;
  /** Change the shell's working directory. */
  setCwd: (next: string) => void;
  /** Clear the scrollback. */
  clear: () => void;
  history: string[];
}

export interface CommandResult {
  stdout?: string;
  stderr?: string;
  /** Non-zero marks failure; the prompt shows it. */
  code?: number;
}

export interface CommandDefinition {
  name: string;
  summary: string;
  usage: string;
  run: (context: CommandContext) => CommandResult | Promise<CommandResult>;
}

const HOME = '/';

/* ------------------------------- Utilities ------------------------------- */

function resolvePath(cwd: string, target: string): string {
  if (target === '~') return HOME;
  if (target.startsWith('~/')) return path.normalize(HOME + target.slice(1));
  return path.resolve(cwd, target);
}

function requireNode(cwd: string, target: string): FSNode {
  const resolved = resolvePath(cwd, target);
  const node = vfs.nodeAt(resolved);
  if (!node) throw new FSError('ENOENT', `${target}: No such file or directory`);
  return node;
}

function fail(message: string): CommandResult {
  return { stderr: message, code: 1 };
}

function columns(names: string[], width = 80): string {
  if (names.length === 0) return '';
  const longest = Math.max(...names.map((name) => name.length)) + 2;
  const perRow = Math.max(1, Math.floor(width / longest));
  const rows: string[] = [];
  for (let index = 0; index < names.length; index += perRow) {
    rows.push(
      names
        .slice(index, index + perRow)
        .map((name) => name.padEnd(longest))
        .join('')
        .trimEnd(),
    );
  }
  return rows.join('\n');
}

/* -------------------------------- Commands ------------------------------- */

const commands: CommandDefinition[] = [];

function define(definition: CommandDefinition) {
  commands.push(definition);
}

define({
  name: 'help',
  summary: 'List available commands',
  usage: 'help [command]',
  run: ({ args }) => {
    if (args[0]) {
      const command = findCommand(args[0]);
      if (!command) return fail(`help: no such command "${args[0]}"`);
      return { stdout: `${command.name} — ${command.summary}\n\nUsage: ${command.usage}` };
    }
    const width = Math.max(...commands.map((c) => c.name.length)) + 2;
    const lines = [...commands]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((command) => `  ${command.name.padEnd(width)}${command.summary}`);
    return {
      stdout: [
        `${OS_NAME} shell — commands operate on the virtual filesystem only.`,
        '',
        ...lines,
        '',
        'Pipes (|) and redirection (>, >>, <) are supported.',
        'Type "help <command>" for usage.',
      ].join('\n'),
    };
  },
});

define({
  name: 'clear',
  summary: 'Clear the screen',
  usage: 'clear',
  run: ({ clear }) => {
    clear();
    return {};
  },
});

define({
  name: 'pwd',
  summary: 'Print the working directory',
  usage: 'pwd',
  run: ({ cwd }) => ({ stdout: cwd }),
});

define({
  name: 'ls',
  summary: 'List directory contents',
  usage: 'ls [-l] [-a] [path…]',
  run: ({ cwd, args }) => {
    const { flags, positional } = parseFlags(args);
    const targets = positional.length > 0 ? positional : ['.'];
    const sections: string[] = [];

    for (const target of targets) {
      let node: FSNode;
      try {
        node = requireNode(cwd, target);
      } catch (err) {
        return fail(`ls: ${err instanceof FSError ? err.message : String(err)}`);
      }

      const entries =
        node.kind === 'folder'
          ? vfs.list(node.id).sort((a, b) => {
              if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
              return a.name.localeCompare(b.name, undefined, { numeric: true });
            })
          : [node];

      const visible = flags.has('a') ? entries : entries.filter((entry) => !entry.name.startsWith('.'));

      let body: string;
      if (flags.has('l')) {
        body = visible
          .map((entry) => {
            const kind = entry.kind === 'folder' ? 'd' : '-';
            const perms = entry.system ? 'r-xr-xr-x' : 'rw-rw-r--';
            const size = entry.kind === 'folder' ? '-' : formatBytes(entry.size);
            return `${kind}${perms}  ${size.padStart(9)}  ${formatDate(entry.modifiedAt).padEnd(22)}  ${entry.name}${entry.kind === 'folder' ? '/' : ''}`;
          })
          .join('\n');
        if (visible.length > 0) body = `total ${visible.length}\n${body}`;
      } else {
        body = columns(visible.map((entry) => (entry.kind === 'folder' ? `${entry.name}/` : entry.name)));
      }

      sections.push(targets.length > 1 ? `${target}:\n${body}` : body);
    }

    return { stdout: sections.join('\n\n') };
  },
});

define({
  name: 'cd',
  summary: 'Change the working directory',
  usage: 'cd [path]',
  run: ({ cwd, args, setCwd }) => {
    const target = args[0] ?? '~';
    if (target === '-') return fail('cd: previous-directory (-) is not supported');
    try {
      const node = requireNode(cwd, target);
      if (node.kind !== 'folder') return fail(`cd: ${target}: Not a directory`);
      setCwd(vfs.pathOf(node.id));
      return {};
    } catch (err) {
      return fail(`cd: ${err instanceof FSError ? err.message : String(err)}`);
    }
  },
});

define({
  name: 'mkdir',
  summary: 'Create directories',
  usage: 'mkdir [-p] <path…>',
  run: async ({ cwd, args }) => {
    const { flags, positional } = parseFlags(args);
    if (positional.length === 0) return fail('mkdir: missing operand');
    for (const target of positional) {
      const resolved = resolvePath(cwd, target);
      try {
        if (flags.has('p')) {
          await vfs.mkdirp(resolved);
        } else {
          const parent = vfs.nodeAt(path.dirname(resolved));
          if (!parent) return fail(`mkdir: cannot create "${target}": No such file or directory`);
          await vfs.createFolder(parent.id, path.basename(resolved));
        }
      } catch (err) {
        return fail(`mkdir: ${err instanceof FSError ? err.message : String(err)}`);
      }
    }
    return {};
  },
});

define({
  name: 'touch',
  summary: 'Create empty files, or update their timestamp',
  usage: 'touch <file…>',
  run: async ({ cwd, args }) => {
    if (args.length === 0) return fail('touch: missing operand');
    for (const target of args) {
      const resolved = resolvePath(cwd, target);
      const existing = vfs.nodeAt(resolved);
      try {
        if (existing) {
          if (existing.kind === 'file') await vfs.writeNode(existing.id, await vfs.readNode(existing.id));
        } else {
          const parent = vfs.nodeAt(path.dirname(resolved));
          if (!parent) return fail(`touch: cannot touch "${target}": No such file or directory`);
          await vfs.createFile(parent.id, path.basename(resolved), '');
        }
      } catch (err) {
        return fail(`touch: ${err instanceof FSError ? err.message : String(err)}`);
      }
    }
    return {};
  },
});

define({
  name: 'cat',
  summary: 'Print file contents',
  usage: 'cat <file…>',
  run: async ({ cwd, args, stdin }) => {
    if (args.length === 0) return { stdout: stdin };
    const parts: string[] = [];
    for (const target of args) {
      try {
        const node = requireNode(cwd, target);
        if (node.kind === 'folder') return fail(`cat: ${target}: Is a directory`);
        if (!isTextMime(node.mime)) {
          return fail(`cat: ${target}: binary file (${describeMime(node.mime)}) — use "open ${target}" instead`);
        }
        parts.push(await vfs.readText(node.id));
      } catch (err) {
        return fail(`cat: ${err instanceof FSError ? err.message : String(err)}`);
      }
    }
    return { stdout: parts.join('') };
  },
});

define({
  name: 'echo',
  summary: 'Print text',
  usage: 'echo [text…]',
  run: ({ args }) => ({ stdout: args.join(' ') }),
});

define({
  name: 'cp',
  summary: 'Copy files and folders',
  usage: 'cp <source…> <destination>',
  run: async ({ cwd, args }) => {
    const { positional } = parseFlags(args);
    if (positional.length < 2) return fail('cp: missing destination operand');
    const destination = positional[positional.length - 1];
    const sources = positional.slice(0, -1);
    const destinationPath = resolvePath(cwd, destination);
    const destinationNode = vfs.nodeAt(destinationPath);

    for (const source of sources) {
      try {
        const node = requireNode(cwd, source);
        if (destinationNode?.kind === 'folder') {
          await vfs.copy(node.id, destinationNode.id, node.name);
        } else {
          const parent = vfs.nodeAt(path.dirname(destinationPath));
          if (!parent) return fail(`cp: cannot create "${destination}": No such file or directory`);
          if (sources.length > 1) return fail(`cp: target "${destination}" is not a directory`);
          await vfs.copy(node.id, parent.id, path.basename(destinationPath));
        }
      } catch (err) {
        return fail(`cp: ${err instanceof FSError ? err.message : String(err)}`);
      }
    }
    return {};
  },
});

define({
  name: 'mv',
  summary: 'Move or rename files and folders',
  usage: 'mv <source…> <destination>',
  run: async ({ cwd, args }) => {
    const { positional } = parseFlags(args);
    if (positional.length < 2) return fail('mv: missing destination operand');
    const destination = positional[positional.length - 1];
    const sources = positional.slice(0, -1);
    const destinationPath = resolvePath(cwd, destination);
    const destinationNode = vfs.nodeAt(destinationPath);

    for (const source of sources) {
      try {
        const node = requireNode(cwd, source);
        if (destinationNode?.kind === 'folder') {
          await vfs.move(node.id, destinationNode.id);
        } else {
          const parent = vfs.nodeAt(path.dirname(destinationPath));
          if (!parent) return fail(`mv: cannot move to "${destination}": No such file or directory`);
          if (sources.length > 1) return fail(`mv: target "${destination}" is not a directory`);
          await vfs.move(node.id, parent.id, path.basename(destinationPath));
        }
      } catch (err) {
        return fail(`mv: ${err instanceof FSError ? err.message : String(err)}`);
      }
    }
    return {};
  },
});

define({
  name: 'rename',
  summary: 'Rename a single file or folder',
  usage: 'rename <path> <new name>',
  run: async ({ cwd, args }) => {
    if (args.length < 2) return fail('rename: usage: rename <path> <new name>');
    try {
      const node = requireNode(cwd, args[0]);
      await vfs.rename(node.id, args[1]);
      return {};
    } catch (err) {
      return fail(`rename: ${err instanceof FSError ? err.message : String(err)}`);
    }
  },
});

define({
  name: 'rm',
  summary: 'Move to Trash, or delete permanently with -f',
  usage: 'rm [-r] [-f] <path…>',
  run: async ({ cwd, args }) => {
    const { flags, positional } = parseFlags(args);
    if (positional.length === 0) return fail('rm: missing operand');

    for (const target of positional) {
      try {
        const node = requireNode(cwd, target);
        if (node.kind === 'folder' && !flags.has('r') && vfs.list(node.id).length > 0) {
          return fail(`rm: ${target}: is a non-empty directory (use -r)`);
        }
        if (flags.has('f')) await vfs.deletePermanently(node.id);
        else await vfs.moveToTrash(node.id);
      } catch (err) {
        return fail(`rm: ${err instanceof FSError ? err.message : String(err)}`);
      }
    }
    return {
      stdout: flags.has('f')
        ? undefined
        : `Moved to Trash. Use "rm -f" to delete permanently, or restore from Files.`,
    };
  },
});

define({
  name: 'tree',
  summary: 'Show a directory tree',
  usage: 'tree [path] [--depth=N]',
  run: ({ cwd, args }) => {
    const { long, positional } = parseFlags(args);
    const depthArg = [...long].find((value) => value.startsWith('depth='));
    const maxDepth = depthArg ? Number(depthArg.split('=')[1]) || 3 : 3;

    let root: FSNode;
    try {
      root = requireNode(cwd, positional[0] ?? '.');
    } catch (err) {
      return fail(`tree: ${err instanceof FSError ? err.message : String(err)}`);
    }
    if (root.kind !== 'folder') return { stdout: root.name };

    const lines: string[] = [vfs.pathOf(root.id)];
    let files = 0;
    let folders = 0;

    const walk = (node: FSNode, prefix: string, depth: number) => {
      if (depth > maxDepth) return;
      const children = vfs.list(node.id).sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });
      children.forEach((child, index) => {
        const last = index === children.length - 1;
        lines.push(`${prefix}${last ? '└── ' : '├── '}${child.name}${child.kind === 'folder' ? '/' : ''}`);
        if (child.kind === 'folder') {
          folders += 1;
          walk(child, `${prefix}${last ? '    ' : '│   '}`, depth + 1);
        } else {
          files += 1;
        }
      });
    };

    walk(root, '', 1);
    lines.push('', `${folders} directories, ${files} files`);
    return { stdout: lines.join('\n') };
  },
});

define({
  name: 'find',
  summary: 'Search for files by name',
  usage: 'find [path] <pattern>',
  run: ({ cwd, args }) => {
    const { positional } = parseFlags(args);
    if (positional.length === 0) return fail('find: missing search pattern');
    const [first, second] = positional;
    const root = second ? resolvePath(cwd, first) : cwd;
    const pattern = second ?? first;

    const results = vfs.search(pattern, { root, limit: 200 });
    if (results.length === 0) return { stdout: `No matches for "${pattern}" under ${root}` };
    return { stdout: results.map((node) => vfs.pathOf(node.id)).join('\n') };
  },
});

define({
  name: 'grep',
  summary: 'Search text for a pattern',
  usage: 'grep [-i] <pattern> [file…]',
  run: async ({ cwd, args, stdin }) => {
    const { flags, positional } = parseFlags(args);
    if (positional.length === 0) return fail('grep: missing pattern');
    const [pattern, ...files] = positional;
    const needle = flags.has('i') ? pattern.toLowerCase() : pattern;

    const scan = (content: string, label?: string) =>
      content
        .split('\n')
        .filter((line) => (flags.has('i') ? line.toLowerCase() : line).includes(needle))
        .map((line) => (label ? `${label}:${line}` : line));

    if (files.length === 0) {
      if (!stdin) return fail('grep: no input — pipe something in, or name a file');
      return { stdout: scan(stdin).join('\n') };
    }

    const matches: string[] = [];
    for (const file of files) {
      try {
        const node = requireNode(cwd, file);
        if (node.kind === 'folder') continue;
        if (!isTextMime(node.mime)) continue;
        matches.push(...scan(await vfs.readText(node.id), files.length > 1 ? file : undefined));
      } catch (err) {
        return fail(`grep: ${err instanceof FSError ? err.message : String(err)}`);
      }
    }
    return { stdout: matches.join('\n'), code: matches.length > 0 ? 0 : 1 };
  },
});

define({
  name: 'wc',
  summary: 'Count lines, words and characters',
  usage: 'wc [file…]',
  run: async ({ cwd, args, stdin }) => {
    const count = (content: string, label?: string) => {
      const lines = content.length === 0 ? 0 : content.split('\n').length;
      const words = content.trim() ? content.trim().split(/\s+/).length : 0;
      return `${String(lines).padStart(6)}${String(words).padStart(8)}${String(content.length).padStart(9)}${label ? `  ${label}` : ''}`;
    };

    if (args.length === 0) return { stdout: count(stdin) };
    const rows: string[] = [];
    for (const file of args) {
      try {
        const node = requireNode(cwd, file);
        if (node.kind === 'folder') return fail(`wc: ${file}: Is a directory`);
        rows.push(count(await vfs.readText(node.id), file));
      } catch (err) {
        return fail(`wc: ${err instanceof FSError ? err.message : String(err)}`);
      }
    }
    return { stdout: rows.join('\n') };
  },
});

define({
  name: 'head',
  summary: 'Show the first lines of input',
  usage: 'head [-n N] [file]',
  run: async ({ cwd, args, stdin }) => {
    const { positional } = parseFlags(args);
    const nIndex = args.indexOf('-n');
    const limit = nIndex >= 0 ? Number(args[nIndex + 1]) || 10 : 10;
    const source = positional.find((value) => value !== String(limit));
    let content = stdin;
    if (source) {
      try {
        content = await vfs.readText(requireNode(cwd, source).id);
      } catch (err) {
        return fail(`head: ${err instanceof FSError ? err.message : String(err)}`);
      }
    }
    return { stdout: content.split('\n').slice(0, limit).join('\n') };
  },
});

define({
  name: 'tail',
  summary: 'Show the last lines of input',
  usage: 'tail [-n N] [file]',
  run: async ({ cwd, args, stdin }) => {
    const { positional } = parseFlags(args);
    const nIndex = args.indexOf('-n');
    const limit = nIndex >= 0 ? Number(args[nIndex + 1]) || 10 : 10;
    const source = positional.find((value) => value !== String(limit));
    let content = stdin;
    if (source) {
      try {
        content = await vfs.readText(requireNode(cwd, source).id);
      } catch (err) {
        return fail(`tail: ${err instanceof FSError ? err.message : String(err)}`);
      }
    }
    const lines = content.split('\n');
    return { stdout: lines.slice(Math.max(0, lines.length - limit)).join('\n') };
  },
});

define({
  name: 'sort',
  summary: 'Sort lines of input',
  usage: 'sort [-r]',
  run: ({ args, stdin }) => {
    const { flags } = parseFlags(args);
    const lines = stdin.split('\n').filter((line) => line.length > 0);
    lines.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (flags.has('r')) lines.reverse();
    return { stdout: lines.join('\n') };
  },
});

define({
  name: 'date',
  summary: 'Show the current date and time',
  usage: 'date',
  run: () => ({ stdout: new Date().toString() }),
});

define({
  name: 'whoami',
  summary: 'Show the current user',
  usage: 'whoami',
  run: () => ({ stdout: getProfile().username }),
});

define({
  name: 'uname',
  summary: 'Show system information',
  usage: 'uname [-a]',
  run: ({ args }) => {
    const { flags } = parseFlags(args);
    if (!flags.has('a')) return { stdout: OS_NAME };
    return {
      stdout: `${OS_NAME} ${OS_VERSION} (${OS_CODENAME}) browser ${navigator.userAgent.split(' ').pop() ?? 'unknown'}`,
    };
  },
});

define({
  name: 'env',
  summary: 'Show shell environment values',
  usage: 'env',
  run: ({ cwd }) => {
    const settings = getSettings();
    return {
      stdout: [
        `USER=${getProfile().username}`,
        `HOME=${HOME}`,
        `PWD=${cwd}`,
        `SHELL=/bin/palmsh`,
        `OS=${OS_NAME} ${OS_VERSION}`,
        `THEME=${settings.theme}`,
        `ACCENT=${settings.accent}`,
      ].join('\n'),
    };
  },
});

define({
  name: 'history',
  summary: 'Show recent commands',
  usage: 'history',
  run: ({ history }) =>
    ({ stdout: history.map((line, index) => `${String(index + 1).padStart(4)}  ${line}`).join('\n') }),
});

define({
  name: 'df',
  summary: 'Show storage usage',
  usage: 'df',
  run: async () => {
    const stats = vfs.stats();
    const estimate = await estimateStorage();
    const rows = [
      'Filesystem        Used     Files   Folders',
      `palmfs      ${formatBytes(stats.bytes).padStart(10)}${String(stats.files).padStart(10)}${String(stats.folders).padStart(10)}`,
    ];
    if (estimate) {
      const percent = estimate.quota > 0 ? ((estimate.usage / estimate.quota) * 100).toFixed(1) : '0';
      rows.push(
        '',
        `Browser storage: ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} (${percent}%)`,
      );
    } else {
      rows.push('', 'Browser storage: not reported by this browser.');
    }
    return { stdout: rows.join('\n') };
  },
});

define({
  name: 'du',
  summary: 'Show the size of a directory',
  usage: 'du [path]',
  run: ({ cwd, args }) => {
    try {
      const node = requireNode(cwd, args[0] ?? '.');
      const counts = node.kind === 'folder' ? vfs.countWithin(node.id) : { files: 1, folders: 0 };
      return {
        stdout: `${formatBytes(vfs.sizeOf(node.id))}\t${vfs.pathOf(node.id)}  (${counts.files} files, ${counts.folders} folders)`,
      };
    } catch (err) {
      return fail(`du: ${err instanceof FSError ? err.message : String(err)}`);
    }
  },
});

define({
  name: 'open',
  summary: 'Open a file or folder in its application',
  usage: 'open <path>',
  run: ({ cwd, args }) => {
    if (!args[0]) return fail('open: missing operand');
    try {
      const node = requireNode(cwd, args[0]);
      OS.openFile(node);
      return { stdout: `Opening ${node.name}…` };
    } catch (err) {
      return fail(`open: ${err instanceof FSError ? err.message : String(err)}`);
    }
  },
});

define({
  name: 'edit',
  summary: 'Open a file in the Text Editor',
  usage: 'edit <path>',
  run: async ({ cwd, args }) => {
    if (!args[0]) return fail('edit: missing operand');
    const resolved = resolvePath(cwd, args[0]);
    let node = vfs.nodeAt(resolved);
    if (!node) {
      const parent = vfs.nodeAt(path.dirname(resolved));
      if (!parent) return fail(`edit: ${args[0]}: No such file or directory`);
      node = await vfs.createFile(parent.id, path.basename(resolved), '');
    }
    OS.openApp('text-editor', { params: { path: vfs.pathOf(node.id), nodeId: node.id } });
    return { stdout: `Editing ${node.name}…` };
  },
});

define({
  name: 'apps',
  summary: 'List installed applications',
  usage: 'apps [--launch <id>]',
  run: ({ args }) => {
    const { long, positional } = parseFlags(args);
    if (long.has('launch') || positional[0] === 'launch') {
      const id = positional[positional[0] === 'launch' ? 1 : 0];
      if (!id) return fail('apps: give an application id to launch');
      const opened = OS.openApp(id);
      return opened ? { stdout: `Launched ${id}` } : fail(`apps: no application with id "${id}"`);
    }
    const apps = launchableApps();
    const width = Math.max(...apps.map((app) => app.id.length)) + 2;
    return {
      stdout: apps.map((app) => `  ${app.id.padEnd(width)}${app.name} — ${app.description}`).join('\n'),
    };
  },
});

define({
  name: 'notify',
  summary: 'Send a desktop notification',
  usage: 'notify <title> [body]',
  run: ({ args }) => {
    if (args.length === 0) return fail('notify: missing title');
    OS.notify({ appId: 'terminal', title: args[0], body: args.slice(1).join(' ') || undefined });
    return {};
  },
});

define({
  name: 'fetchsite',
  summary: 'Install a web application so it can be used offline',
  usage: 'fetchsite <url> [name] [--no-capture]',
  run: async ({ args }) => {
    if (!args[0]) {
      return fail('fetchsite: give an address, e.g. fetchsite https://excalidraw.com');
    }
    const { long, positional } = parseFlags(args);
    if (!positional[0]) {
      return fail('fetchsite: give an address, e.g. fetchsite https://excalidraw.com');
    }
    const [url, ...rest] = positional;
    const name = rest.join(' ').trim() || undefined;

    const manifest = await useSitesStore
      .getState()
      .install(url, { name, captureRuntime: !long.has('no-capture') });
    if (!manifest) return fail(`fetchsite: could not install ${url}`);

    const origin = appOrigin(manifest.id);
    const lines = [
      `Installed "${manifest.name}" from ${manifest.primaryHost}`,
      `  ${manifest.fileCount} files, ${(manifest.bytes / 1024).toFixed(0)} KB`,
      `  status: ${statusLabel(manifest.status)} — ${statusSummary(manifest)}`,
      `  origin: ${origin ?? 'unavailable'}`,
    ];
    if (manifest.missingResources.length > 0) {
      lines.push(
        `  ${manifest.missingResources.length} resource${manifest.missingResources.length === 1 ? '' : 's'} could not be archived:`,
        ...manifest.missingResources.slice(0, 5).map((entry) => `    ${entry.url} (${entry.reason})`),
      );
    }
    lines.push('', `Run it with: apps --launch ${siteAppId(manifest.id)}`);
    return { stdout: lines.join('\n') };
  },
});

define({
  name: 'sites',
  summary: 'List installed web applications',
  usage: 'sites [--remove <id>] [--origins]',
  run: async ({ args }) => {
    const { long, positional } = parseFlags(args);
    const store = useSitesStore.getState();

    if (long.has('remove') || positional[0] === 'remove') {
      const id = positional[positional[0] === 'remove' ? 1 : 0];
      const target = store.installed.find(
        (manifest) => manifest.id === id || manifest.primaryHost === id,
      );
      if (!target) return fail(`sites: no installed application matching "${id ?? ''}"`);
      await store.uninstall(target.id);
      return { stdout: `Removed "${target.name}".` };
    }

    if (store.installed.length === 0) {
      return { stdout: 'No applications installed. Use "fetchsite <url>" to add one.' };
    }

    // Each application is on its own origin; showing them makes that concrete
    // rather than something the user has to take on trust.
    if (long.has('origins')) {
      return {
        stdout: store.installed
          .map((manifest) => `  ${manifest.name}\n    ${appOrigin(manifest.id) ?? 'unavailable'}`)
          .join('\n'),
      };
    }

    const width = Math.max(...store.installed.map((manifest) => manifest.name.length)) + 2;
    return {
      stdout: store.installed
        .map(
          (manifest) =>
            `  ${manifest.name.padEnd(width)}${manifest.primaryHost.padEnd(24)}` +
            `${statusLabel(manifest.status).padEnd(16)}` +
            `${manifest.permissions.includes('NETWORK') ? 'online ' : 'offline'}` +
            `${formatBytes(manifest.bytes).padStart(9)}  ${manifest.id}`,
        )
        .join('\n'),
    };
  },
});

define({
  name: 'neofetch',
  summary: 'Show a system summary',
  usage: 'neofetch',
  run: async () => {
    const profile = getProfile();
    const stats = vfs.stats();
    const estimate = await estimateStorage();
    const windows = useWindowStore.getState().windows;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } })
      .memory;

    const info = [
      `${profile.username}@palm`,
      '─────────────────────',
      `OS         ${OS_NAME} ${OS_VERSION} (${OS_CODENAME})`,
      `Host       ${navigator.platform || 'Browser'}`,
      `Kernel     Web Platform`,
      `Shell      palmsh`,
      `Resolution ${window.screen.width}×${window.screen.height}`,
      `Viewport   ${window.innerWidth}×${window.innerHeight}`,
      `Theme      ${getSettings().theme}`,
      `Windows    ${windows.length} open`,
      `Files      ${stats.files} files, ${stats.folders} folders`,
      `Disk       ${formatBytes(stats.bytes)} used`,
      estimate
        ? `Storage    ${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`
        : `Storage    not reported`,
      memory
        ? `Memory     ${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)}`
        : `Memory     not exposed by this browser`,
      `Online     ${navigator.onLine ? 'yes' : 'no'}`,
    ];

    const logo = [
      '        .::.        ',
      '     .:;;;;;;:.     ',
      '   .:;;;;;;;;;;:.   ',
      '  :;;;;;;;;;;;;;;:  ',
      '   `:;;;;;;;;;;:`   ',
      '        ;;;;        ',
      '        ;;;;        ',
      '       ,;;;;,       ',
      '     .:;;;;;;:.     ',
    ];

    const height = Math.max(logo.length, info.length);
    const rows: string[] = [];
    for (let index = 0; index < height; index += 1) {
      rows.push(`${(logo[index] ?? '').padEnd(22)}${info[index] ?? ''}`);
    }
    return { stdout: rows.join('\n') };
  },
});

define({
  name: 'systeminfo',
  summary: 'Show detailed system and browser information',
  usage: 'systeminfo',
  run: async () => {
    const estimate = await estimateStorage();
    const stats = vfs.stats();
    const rows: Array<[string, string]> = [
      ['OS name', `${OS_NAME} ${OS_VERSION} "${OS_CODENAME}"`],
      ['User', getProfile().displayName],
      ['User agent', navigator.userAgent],
      ['Language', navigator.language],
      ['Languages', navigator.languages.join(', ')],
      ['Platform', navigator.platform || 'not reported'],
      ['CPU threads', navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : 'not exposed'],
      ['Screen', `${window.screen.width}×${window.screen.height} @ ${window.devicePixelRatio}×`],
      ['Colour depth', `${window.screen.colorDepth}-bit`],
      ['Viewport', `${window.innerWidth}×${window.innerHeight}`],
      ['Timezone', Intl.DateTimeFormat().resolvedOptions().timeZone],
      ['Online', navigator.onLine ? 'yes' : 'no'],
      ['Cookies enabled', navigator.cookieEnabled ? 'yes' : 'no'],
      ['Virtual filesystem', `${stats.files} files, ${stats.folders} folders, ${formatBytes(stats.bytes)}`],
      ['Browser storage', estimate ? `${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}` : 'not reported'],
      ['Open windows', String(useWindowStore.getState().windows.length)],
    ];
    const width = Math.max(...rows.map(([label]) => label.length)) + 2;
    return { stdout: rows.map(([label, value]) => `${label.padEnd(width)}${value}`).join('\n') };
  },
});

define({
  name: 'theme',
  summary: 'Switch between the light and dark theme',
  usage: 'theme [light|dark|system]',
  run: ({ args }) => {
    const value = args[0];
    if (!value) return { stdout: `Current theme: ${getSettings().theme}` };
    if (value !== 'light' && value !== 'dark' && value !== 'system') {
      return fail('theme: expected "light", "dark" or "system"');
    }
    OS.settings.set('theme', value);
    return { stdout: `Theme set to ${value}` };
  },
});

define({
  name: 'sudo',
  summary: 'Explain why privilege escalation does not exist here',
  usage: 'sudo <command>',
  run: () => ({
    stdout: [
      'There is no superuser here.',
      '',
      `${OS_NAME} runs inside a web page. It has no kernel, no processes and no access`,
      "to your real operating system — so there is nothing to escalate to.",
      '',
      'The shell can only touch the virtual filesystem stored in this browser.',
    ].join('\n'),
  }),
});

define({
  name: 'exit',
  summary: 'Close the terminal window',
  usage: 'exit',
  run: () => ({ stdout: '__PALM_EXIT__' }),
});

/* -------------------------------- Registry ------------------------------- */

const ALIASES: Record<string, string> = {
  dir: 'ls',
  ll: 'ls',
  cls: 'clear',
  md: 'mkdir',
  del: 'rm',
  move: 'mv',
  copy: 'cp',
  type: 'cat',
  '?': 'help',
  man: 'help',
};

export function findCommand(name: string): CommandDefinition | undefined {
  const resolved = ALIASES[name] ?? name;
  return commands.find((command) => command.name === resolved);
}

export function commandNames(): string[] {
  return [...commands.map((command) => command.name), ...Object.keys(ALIASES)].sort();
}

export { resolvePath };
