import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppProps } from '../../core/app-manager/types';
import * as path from '../../core/filesystem/path';
import { FSError, vfs } from '../../core/filesystem/vfs';
import { getProfile } from '../../core/settings/store';
import { OS_NAME, OS_VERSION } from '../../core/settings/defaults';
import { useOS } from '../../desktop/app-context';
import { cn } from '../../utils/cn';
import { uid } from '../../utils/misc';
import { commandNames, findCommand, resolvePath } from './commands';
import type { CommandContext } from './commands';
import { ParseError, parseLine } from './parser';

interface Line {
  id: string;
  kind: 'input' | 'output' | 'error' | 'system';
  text: string;
}

const MAX_LINES = 1200;
const MAX_HISTORY = 300;

export default function TerminalApp({ params }: AppProps<{ cwd?: string }>) {
  const { os } = useOS();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [cwd, setCwd] = useState(() => {
    const requested = params?.cwd;
    return requested && vfs.nodeAt(requested) ? requested : '/';
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<Line[]>(() => [
    { id: uid('l'), kind: 'system', text: `${OS_NAME} ${OS_VERSION} — palmsh` },
    {
      id: uid('l'),
      kind: 'system',
      text: 'Type "help" for commands. This shell only sees the Palm OS virtual filesystem.',
    },
    { id: uid('l'), kind: 'system', text: '' },
  ]);

  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [draft, setDraft] = useState('');
  const [completions, setCompletions] = useState<string[]>([]);

  const username = getProfile().username;
  const prompt = useMemo(() => `${username}@palm:${path.tildify(cwd, '/')}$`, [cwd, username]);

  useEffect(() => {
    os.window.setTitle(`${path.tildify(cwd, '/')} — Terminal`);
  }, [cwd, os]);

  /* Load and persist shell history across sessions. */
  useEffect(() => {
    let cancelled = false;
    void os.storage.get<string[]>('history', []).then((stored) => {
      if (!cancelled && Array.isArray(stored)) setHistory(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [os]);

  const appendLines = useCallback((additions: Line[]) => {
    setLines((current) => {
      const next = [...current, ...additions];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  /* Keep the newest output in view. */
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lines, busy]);

  /* ------------------------------- Execution ------------------------------ */

  const execute = useCallback(
    async (line: string) => {
      const trimmed = line.trim();
      appendLines([{ id: uid('l'), kind: 'input', text: `${prompt} ${line}` }]);

      if (trimmed.length === 0) return;

      const nextHistory = [...history.filter((entry) => entry !== trimmed), trimmed].slice(-MAX_HISTORY);
      setHistory(nextHistory);
      void os.storage.set('history', nextHistory);

      let sequence;
      try {
        sequence = parseLine(trimmed);
      } catch (err) {
        appendLines([
          { id: uid('l'), kind: 'error', text: err instanceof ParseError ? err.message : String(err) },
        ]);
        return;
      }
      if (sequence.length === 0) return;

      setBusy(true);
      let workingDirectory = cwd;
      const output: Line[] = [];
      let shouldClear = false;
      let exitRequested = false;
      let lastCode = 0;

      try {
        for (const item of sequence) {
          // `&&` runs only after success, `||` only after failure.
          if (item.joinedBy === '&&' && lastCode !== 0) continue;
          if (item.joinedBy === '||' && lastCode === 0) continue;

          let stdin = '';
          lastCode = 0;

          for (let index = 0; index < item.pipeline.length; index += 1) {
            const step = item.pipeline[index];
            const command = findCommand(step.name);

            if (!command) {
              output.push({
                id: uid('l'),
                kind: 'error',
                text: `palmsh: ${step.name}: command not found. Type "help" to see what is available.`,
              });
              lastCode = 127;
              break;
            }

            if (step.inputFrom) {
              try {
                const node = vfs.nodeAt(resolvePath(workingDirectory, step.inputFrom));
                if (!node) throw new FSError('ENOENT', `${step.inputFrom}: No such file`);
                stdin = await vfs.readText(node.id);
              } catch (err) {
                output.push({
                  id: uid('l'),
                  kind: 'error',
                  text: `palmsh: ${err instanceof FSError ? err.message : String(err)}`,
                });
                lastCode = 1;
                break;
              }
            }

            const context: CommandContext = {
              cwd: workingDirectory,
              args: step.args,
              stdin,
              setCwd: (next) => {
                workingDirectory = next;
              },
              clear: () => {
                shouldClear = true;
              },
              history: nextHistory,
            };

            const result = await command.run(context);
            const isLast = index === item.pipeline.length - 1;
            lastCode = result.code ?? 0;

            if (result.stderr) {
              output.push({ id: uid('l'), kind: 'error', text: result.stderr });
            }

            let stdout = result.stdout ?? '';
            if (stdout === '__PALM_EXIT__') {
              exitRequested = true;
              stdout = '';
            }

            if (isLast) {
              if (step.redirect) {
                try {
                  const target = resolvePath(workingDirectory, step.redirect.target);
                  const existing = vfs.nodeAt(target);
                  const content =
                    step.redirect.mode === 'append' && existing && existing.kind === 'file'
                      ? `${await vfs.readText(existing.id)}${stdout}\n`
                      : `${stdout}\n`;
                  await vfs.writeFile(target, content, { recursive: true });
                } catch (err) {
                  output.push({
                    id: uid('l'),
                    kind: 'error',
                    text: `palmsh: ${err instanceof FSError ? err.message : String(err)}`,
                  });
                  lastCode = 1;
                }
              } else if (stdout.length > 0) {
                for (const text of stdout.split('\n')) {
                  output.push({ id: uid('l'), kind: 'output', text });
                }
              }
            } else {
              stdin = stdout;
            }
          }
        }
      } catch (err) {
        output.push({
          id: uid('l'),
          kind: 'error',
          text: `palmsh: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        setBusy(false);
      }

      setCwd(workingDirectory);
      if (shouldClear) setLines([]);
      else if (output.length > 0) appendLines(output);

      if (exitRequested) os.window.close();
    },
    [appendLines, cwd, history, os, prompt],
  );

  /* ----------------------------- Tab completion --------------------------- */

  const complete = useCallback(() => {
    const beforeCursor = input;
    const parts = beforeCursor.split(/\s+/);
    const isFirstWord = parts.length <= 1;
    const fragment = parts[parts.length - 1] ?? '';

    let candidates: string[];

    if (isFirstWord) {
      candidates = commandNames().filter((name) => name.startsWith(fragment));
    } else {
      // Complete a path: list the directory the fragment points into.
      const slash = fragment.lastIndexOf('/');
      const directoryPart = slash >= 0 ? fragment.slice(0, slash + 1) : '';
      const namePart = slash >= 0 ? fragment.slice(slash + 1) : fragment;
      const directoryPath = resolvePath(cwd, directoryPart || '.');
      const directory = vfs.nodeAt(directoryPath);
      if (!directory || directory.kind !== 'folder') {
        setCompletions([]);
        return;
      }
      candidates = vfs
        .list(directory.id)
        .filter((node) => node.name.toLowerCase().startsWith(namePart.toLowerCase()))
        .map((node) => `${directoryPart}${node.name}${node.kind === 'folder' ? '/' : ''}`);
    }

    if (candidates.length === 0) {
      setCompletions([]);
      return;
    }

    if (candidates.length === 1) {
      const completed = [...parts.slice(0, -1), candidates[0]].join(' ');
      setInput(candidates[0].endsWith('/') ? completed : `${completed} `);
      setCompletions([]);
      return;
    }

    // Several matches: fill in the longest common prefix and list the options.
    let prefix = candidates[0];
    for (const candidate of candidates) {
      while (!candidate.startsWith(prefix)) prefix = prefix.slice(0, -1);
    }
    if (prefix.length > fragment.length) {
      setInput([...parts.slice(0, -1), prefix].join(' '));
    }
    setCompletions(candidates.slice(0, 40));
  }, [cwd, input]);

  /* -------------------------------- Keyboard ------------------------------ */

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Tab') setCompletions([]);

    switch (event.key) {
      case 'Enter': {
        event.preventDefault();
        if (busy) break;
        const line = input;
        setInput('');
        setHistoryIndex(-1);
        setDraft('');
        void execute(line);
        break;
      }
      case 'Tab':
        event.preventDefault();
        complete();
        break;
      case 'ArrowUp': {
        event.preventDefault();
        if (history.length === 0) break;
        const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        if (historyIndex === -1) setDraft(input);
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
        break;
      }
      case 'ArrowDown': {
        event.preventDefault();
        if (historyIndex === -1) break;
        const nextIndex = historyIndex + 1;
        if (nextIndex >= history.length) {
          setHistoryIndex(-1);
          setInput(draft);
        } else {
          setHistoryIndex(nextIndex);
          setInput(history[nextIndex]);
        }
        break;
      }
      default:
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
          event.preventDefault();
          setLines([]);
        } else if (event.ctrlKey && event.key.toLowerCase() === 'c') {
          event.preventDefault();
          appendLines([{ id: uid('l'), kind: 'input', text: `${prompt} ${input}^C` }]);
          setInput('');
        } else if (event.ctrlKey && event.key.toLowerCase() === 'u') {
          event.preventDefault();
          setInput('');
        }
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[#0b0d13] font-mono text-[12.5px] leading-[1.55]"
      onPointerUp={(event) => {
        // Clicking blank space focuses the prompt, but never steals a selection.
        if (window.getSelection()?.toString()) return;
        if ((event.target as HTMLElement).tagName !== 'INPUT') inputRef.current?.focus();
      }}
    >
      <div
        ref={scrollRef}
        className="os-scroll min-h-0 flex-1 overflow-y-auto px-3 py-2"
        role="log"
        aria-label="Terminal output"
        aria-live="polite"
      >
        {lines.map((line) => (
          <div
            key={line.id}
            className={cn(
              'whitespace-pre-wrap break-words',
              line.kind === 'input' && 'text-[#9ad6c7]',
              line.kind === 'output' && 'text-[#d6dbe6]',
              line.kind === 'error' && 'text-[#ff8b8b]',
              line.kind === 'system' && 'text-[#7b859b]',
            )}
          >
            {line.text || ' '}
          </div>
        ))}

        {completions.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[#7b859b]">
            {completions.map((candidate) => (
              <span key={candidate}>{candidate}</span>
            ))}
          </div>
        ) : null}

        <div className="flex items-start gap-2">
          <span className="shrink-0 whitespace-pre text-[#9ad6c7]">{prompt}</span>
          <input
            ref={inputRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            readOnly={busy}
            autoFocus
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Terminal input"
            className="min-w-0 flex-1 bg-transparent text-[#eef1f7] caret-[#2bc4b0] outline-none read-only:opacity-70"
          />
        </div>
      </div>
    </div>
  );
}
