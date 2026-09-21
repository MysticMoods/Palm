import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button, IconButton } from '../../components/ui/Button';
import { TextField } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Notice } from '../../components/ui/Feedback';
import type { AppProps } from '../../core/app-manager/types';
import { isTextMime } from '../../core/filesystem/mime';
import * as path from '../../core/filesystem/path';
import { FSError, vfs } from '../../core/filesystem/vfs';
import { downloadBlob } from '../../core/filesystem/local';
import { notifications } from '../../core/notifications/store';
import { useOS } from '../../desktop/app-context';
import { usePermissionGate } from '../../desktop/use-permission';
import { cn } from '../../utils/cn';
import { formatRelative } from '../../utils/format';
import { useUndoHistory } from './useUndoHistory';

const AUTOSAVE_MS = 1500;

interface EditorParams {
  path?: string;
  nodeId?: string;
}

export default function TextEditorApp({ params }: AppProps<EditorParams>) {
  const { os } = useOS();
  const ensureFilesystem = usePermissionGate(
    'filesystem',
    'Open and save documents in your Palm OS filesystem.',
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [nodeId, setNodeId] = useState<string | null>(params?.nodeId ?? null);
  const [savedText, setSavedText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [replaceWith, setReplaceWith] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [wrap, setWrap] = useState(true);

  const history = useUndoHistory('');
  const { text, commit, reset, undo, redo, canUndo, canRedo } = history;

  const node = nodeId ? vfs.getNode(nodeId) : null;
  const dirty = text !== savedText;

  /* --------------------------------- Load -------------------------------- */

  useEffect(() => {
    const target = params?.nodeId ?? (params?.path ? vfs.nodeAt(params.path)?.id : undefined);
    if (!target) return;

    const file = vfs.getNode(target);
    if (!file) {
      setLoadError(`"${params?.path ?? target}" no longer exists.`);
      return;
    }
    if (file.kind === 'folder') {
      setLoadError(`"${file.name}" is a folder.`);
      return;
    }
    if (!isTextMime(file.mime)) {
      setLoadError(
        `"${file.name}" is a ${file.mime} file. Opening it as text would show meaningless characters.`,
      );
      setNodeId(target);
      return;
    }

    let cancelled = false;
    void ensureFilesystem()
      .then((granted) => {
        if (!granted) {
          setLoadError('Text Editor was not given permission to read your files.');
          return undefined;
        }
        return vfs.readText(target).then((content) => {
          if (cancelled) return;
          reset(content);
          setSavedText(content);
          setNodeId(target);
          setLoadError(null);
        });
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [ensureFilesystem, params?.nodeId, params?.path, reset]);

  /* ---------------------------------- Save -------------------------------- */

  const save = useCallback(
    async (silent = false) => {
      if (!nodeId) {
        setSaveAsOpen(true);
        return;
      }
      if (!(await ensureFilesystem())) {
        notifications.push('text-editor', {
          title: 'Cannot save',
          body: 'Text Editor does not have permission to write files. Grant it in Settings ▸ Applications.',
          urgency: 'critical',
        });
        return;
      }
      setSaving(true);
      try {
        await vfs.writeNode(nodeId, text);
        setSavedText(text);
        setSavedAt(Date.now());
        if (!silent) {
          notifications.push('text-editor', {
            title: `Saved "${vfs.getNode(nodeId)?.name ?? 'file'}"`,
            tag: 'save',
            timeout: 2500,
          });
        }
      } catch (err) {
        notifications.push('text-editor', {
          title: 'Could not save',
          body: err instanceof FSError ? err.message : String(err),
          urgency: 'critical',
        });
      } finally {
        setSaving(false);
      }
    },
    [ensureFilesystem, nodeId, text],
  );

  /* Autosave keeps work safe; the explicit Save button still exists because
     people expect one, and it gives feedback that autosave cannot. */
  useEffect(() => {
    if (!nodeId || !dirty) return;
    const timer = setTimeout(() => void save(true), AUTOSAVE_MS);
    return () => clearTimeout(timer);
  }, [dirty, nodeId, save, text]);

  /* Warn before closing with unsaved changes. */
  useEffect(() => {
    os.window.setCloseGuard(dirty);
  }, [dirty, os]);

  useEffect(() => {
    os.window.setTitle(`${dirty ? '• ' : ''}${node?.name ?? 'Untitled'} — Text Editor`);
  }, [dirty, node?.name, os]);

  /* Also warn on a full page unload, which the OS cannot intercept itself. */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /* ------------------------------ Find/replace ---------------------------- */

  const matchCount = useMemo(() => {
    if (!findQuery) return 0;
    const haystack = matchCase ? text : text.toLowerCase();
    const needle = matchCase ? findQuery : findQuery.toLowerCase();
    if (!needle) return 0;
    let count = 0;
    let index = haystack.indexOf(needle);
    while (index !== -1) {
      count += 1;
      index = haystack.indexOf(needle, index + needle.length);
    }
    return count;
  }, [findQuery, matchCase, text]);

  const findNext = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !findQuery) return;
    const haystack = matchCase ? text : text.toLowerCase();
    const needle = matchCase ? findQuery : findQuery.toLowerCase();
    const from = textarea.selectionEnd;
    let index = haystack.indexOf(needle, from);
    if (index === -1) index = haystack.indexOf(needle); // wrap around
    if (index === -1) return;
    textarea.focus();
    textarea.setSelectionRange(index, index + needle.length);
  }, [findQuery, matchCase, text]);

  const replaceCurrent = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !findQuery) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = text.slice(start, end);
    const isMatch = matchCase ? selected === findQuery : selected.toLowerCase() === findQuery.toLowerCase();
    if (!isMatch) {
      findNext();
      return;
    }
    const next = text.slice(0, start) + replaceWith + text.slice(end);
    commit(next, { start, end }, { coalesce: false });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + replaceWith.length, start + replaceWith.length);
    });
  }, [commit, findNext, findQuery, matchCase, replaceWith, text]);

  const replaceAll = useCallback(() => {
    if (!findQuery) return;
    let next: string;
    if (matchCase) {
      next = text.split(findQuery).join(replaceWith);
    } else {
      // Build the result by scanning, so the needle needs no regex escaping.
      const lower = text.toLowerCase();
      const needle = findQuery.toLowerCase();
      let result = '';
      let cursor = 0;
      let index = lower.indexOf(needle);
      while (index !== -1) {
        result += text.slice(cursor, index) + replaceWith;
        cursor = index + needle.length;
        index = lower.indexOf(needle, cursor);
      }
      result += text.slice(cursor);
      next = result;
    }
    const replaced = matchCount;
    commit(next, undefined, { coalesce: false });
    notifications.push('text-editor', {
      title: `Replaced ${replaced} ${replaced === 1 ? 'occurrence' : 'occurrences'}`,
      timeout: 2500,
    });
  }, [commit, findQuery, matchCase, matchCount, replaceWith, text]);

  /* -------------------------------- Actions ------------------------------- */

  const saveAs = async (folderPath: string, filename: string) => {
    if (!(await ensureFilesystem())) return;
    try {
      const folder = vfs.nodeAt(folderPath) ?? (await vfs.mkdirp(folderPath));
      const name = vfs.uniqueName(folder.id, filename);
      const created = await vfs.createFile(folder.id, name, text, undefined);
      setNodeId(created.id);
      setSavedText(text);
      setSavedAt(Date.now());
      setSaveAsOpen(false);
      setLoadError(null);
      notifications.push('text-editor', { title: `Saved as "${name}"`, tag: 'save' });
    } catch (err) {
      notifications.push('text-editor', {
        title: 'Could not save',
        body: err instanceof FSError ? err.message : String(err),
        urgency: 'critical',
      });
    }
  };

  const rename = async (name: string) => {
    if (!nodeId) return;
    try {
      await vfs.rename(nodeId, name);
      setRenameOpen(false);
    } catch (err) {
      notifications.push('text-editor', {
        title: 'Could not rename',
        body: err instanceof FSError ? err.message : String(err),
        urgency: 'critical',
      });
    }
  };

  const newDocument = () => {
    reset('');
    setSavedText('');
    setNodeId(null);
    setSavedAt(null);
    setLoadError(null);
  };

  /* -------------------------------- Keyboard ------------------------------ */

  const onKeyDown = (event: React.KeyboardEvent) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) {
      if (event.key === 'Escape' && showFind) {
        setShowFind(false);
        textareaRef.current?.focus();
      }
      return;
    }
    const key = event.key.toLowerCase();

    if (key === 's') {
      event.preventDefault();
      if (event.shiftKey) setSaveAsOpen(true);
      else void save();
    } else if (key === 'f') {
      event.preventDefault();
      setShowFind(true);
    } else if (key === 'h') {
      event.preventDefault();
      setShowFind(true);
    } else if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      const snapshot = undo();
      if (snapshot) restoreSelection(snapshot.selectionStart, snapshot.selectionEnd);
    } else if ((key === 'z' && event.shiftKey) || key === 'y') {
      event.preventDefault();
      const snapshot = redo();
      if (snapshot) restoreSelection(snapshot.selectionStart, snapshot.selectionEnd);
    } else if (key === 'g') {
      event.preventDefault();
      findNext();
    }
  };

  const restoreSelection = (start: number, end: number) => {
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(Math.min(start, textarea.value.length), Math.min(end, textarea.value.length));
    });
  };

  /* Insert a real tab rather than moving focus out of the editor. */
  const onTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const { selectionStart, selectionEnd } = textarea;
    const next = `${text.slice(0, selectionStart)}  ${text.slice(selectionEnd)}`;
    commit(next, { start: selectionStart, end: selectionEnd });
    requestAnimationFrame(() => {
      textarea.setSelectionRange(selectionStart + 2, selectionStart + 2);
    });
  };

  /* --------------------------------- Stats -------------------------------- */

  const stats = useMemo(() => {
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text ? text.split('\n').length : 0;
    return { words, lines, characters: text.length };
  }, [text]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface" onKeyDown={onKeyDown}>
      {/* -------------------------------- Toolbar ------------------------------ */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-edge/8 px-2 py-1.5">
        <IconButton icon="FilePlus" label="New document" size="sm" onClick={newDocument} />
        <IconButton
          icon="FolderOpen"
          label="Open a file"
          size="sm"
          onClick={() => os.openApp('files', { params: { path: '/Documents' } })}
        />
        <IconButton
          icon="Save"
          label="Save (Ctrl+S)"
          size="sm"
          disabled={saving || (!dirty && nodeId !== null)}
          onClick={() => void save()}
        />
        <div className="mx-1 h-5 w-px bg-edge/12" aria-hidden="true" />
        <IconButton icon="Undo2" label="Undo (Ctrl+Z)" size="sm" disabled={!canUndo} onClick={() => {
          const snapshot = undo();
          if (snapshot) restoreSelection(snapshot.selectionStart, snapshot.selectionEnd);
        }} />
        <IconButton icon="Redo2" label="Redo (Ctrl+Shift+Z)" size="sm" disabled={!canRedo} onClick={() => {
          const snapshot = redo();
          if (snapshot) restoreSelection(snapshot.selectionStart, snapshot.selectionEnd);
        }} />
        <div className="mx-1 h-5 w-px bg-edge/12" aria-hidden="true" />
        <IconButton
          icon="Search"
          label="Find and replace (Ctrl+F)"
          size="sm"
          active={showFind}
          onClick={() => setShowFind(!showFind)}
        />
        <IconButton
          icon="AlignLeft"
          label={wrap ? 'Disable word wrap' : 'Enable word wrap'}
          size="sm"
          active={wrap}
          onClick={() => setWrap(!wrap)}
        />

        <span className="mx-1 min-w-0 flex-1 truncate text-center text-[12px] text-ink-3">
          {node ? vfs.pathOf(node.id) : 'Untitled document'}
          {dirty ? ' •' : ''}
        </span>

        <Button size="sm" variant="ghost" icon="Pencil" disabled={!nodeId} onClick={() => setRenameOpen(true)}>
          Rename
        </Button>
        <Button size="sm" variant="ghost" icon="Share2" onClick={() => setSaveAsOpen(true)}>
          Save as
        </Button>
        <IconButton
          icon="Download"
          label="Download to your computer"
          size="sm"
          onClick={() => downloadBlob(text, node?.name ?? 'untitled.txt', node?.mime ?? 'text/plain')}
        />
      </div>

      {/* ----------------------------- Find bar -------------------------------- */}
      {showFind ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-edge/8 bg-surface-2/50 px-2 py-1.5">
          <div className="w-44">
            <TextField
              value={findQuery}
              onChange={(event) => setFindQuery(event.target.value)}
              placeholder="Find"
              label="Find"
              hideLabel
              icon="Search"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  findNext();
                }
              }}
              className="[&_input]:h-7 [&_input]:text-[12px]"
            />
          </div>
          <div className="w-44">
            <TextField
              value={replaceWith}
              onChange={(event) => setReplaceWith(event.target.value)}
              placeholder="Replace with"
              label="Replace with"
              hideLabel
              className="[&_input]:h-7 [&_input]:text-[12px]"
            />
          </div>
          <Button size="sm" variant="ghost" onClick={findNext} disabled={matchCount === 0}>
            Next
          </Button>
          <Button size="sm" variant="ghost" onClick={replaceCurrent} disabled={matchCount === 0}>
            Replace
          </Button>
          <Button size="sm" variant="ghost" onClick={replaceAll} disabled={matchCount === 0}>
            Replace all
          </Button>
          <button
            type="button"
            onClick={() => setMatchCase(!matchCase)}
            aria-pressed={matchCase}
            title="Match case"
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              matchCase ? 'bg-accent-soft text-accent-ink' : 'text-ink-3 hover:bg-surface-3 hover:text-ink',
            )}
          >
            Aa
          </button>
          <span aria-live="polite" className="text-[11px] tabular-nums text-ink-3">
            {findQuery ? `${matchCount} ${matchCount === 1 ? 'match' : 'matches'}` : ''}
          </span>
          <IconButton
            icon="X"
            label="Close find bar"
            size="sm"
            className="ml-auto"
            onClick={() => {
              setShowFind(false);
              textareaRef.current?.focus();
            }}
          />
        </div>
      ) : null}

      {/* -------------------------------- Editor ------------------------------- */}
      {loadError ? (
        <div className="p-4">
          <Notice tone="warn" icon="AlertTriangle" title="This file cannot be edited as text">
            {loadError}
          </Notice>
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) =>
            commit(event.target.value, {
              start: event.target.selectionStart,
              end: event.target.selectionEnd,
            })
          }
          onKeyDown={onTextareaKeyDown}
          spellCheck={false}
          aria-label="Document text"
          placeholder="Start typing…"
          wrap={wrap ? 'soft' : 'off'}
          className={cn(
            'os-scroll min-h-0 flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[13px]',
            'leading-relaxed text-ink outline-none placeholder:text-ink-3',
            !wrap && 'whitespace-pre overflow-x-auto',
          )}
        />
      )}

      {/* ------------------------------ Status bar ----------------------------- */}
      <div
        role="status"
        className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-edge/8 bg-surface-2/40 px-3 py-1.5 text-[11px] text-ink-3"
      >
        <span className="tabular-nums">
          {stats.lines} lines · {stats.words} words · {stats.characters} characters
        </span>
        <span className="flex items-center gap-1.5">
          {saving ? (
            <>
              <Icon name="Loader" size={11} className="anim-spin" /> Saving…
            </>
          ) : dirty ? (
            <>
              <Icon name="Circle" size={8} className="text-warn" /> Unsaved changes
            </>
          ) : savedAt ? (
            <>
              <Icon name="Check" size={11} className="text-ok" /> Saved {formatRelative(savedAt)}
            </>
          ) : (
            'Ready'
          )}
        </span>
      </div>

      <SaveAsDialog
        open={saveAsOpen}
        defaultName={node?.name ?? 'Untitled.txt'}
        onClose={() => setSaveAsOpen(false)}
        onSave={saveAs}
      />

      <RenameDialog
        open={renameOpen}
        currentName={node?.name ?? ''}
        onClose={() => setRenameOpen(false)}
        onRename={rename}
      />
    </div>
  );
}

function SaveAsDialog({
  open,
  defaultName,
  onClose,
  onSave,
}: {
  open: boolean;
  defaultName: string;
  onClose: () => void;
  onSave: (folder: string, filename: string) => void;
}) {
  const [folder, setFolder] = useState('/Documents');
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  const valid = path.isValidName(name);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Save as"
      icon="Save"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSave(folder, name)}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <TextField
          label="Folder"
          value={folder}
          onChange={(event) => setFolder(event.target.value)}
          icon="Folder"
          hint="The folder is created if it does not exist."
        />
        <TextField
          label="File name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={valid ? undefined : 'Names cannot contain slashes or be empty.'}
          autoFocus
          data-autofocus
        />
      </div>
    </Modal>
  );
}

function RenameDialog({
  open,
  currentName,
  onClose,
  onRename,
}: {
  open: boolean;
  currentName: string;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [name, setName] = useState(currentName);
  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const valid = path.isValidName(name);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Rename file"
      icon="Pencil"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={() => onRename(name)}>
            Rename
          </Button>
        </>
      }
    >
      <div className="pb-2">
        <TextField
          label="New name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={valid ? undefined : 'Names cannot contain slashes or be empty.'}
          autoFocus
          data-autofocus
          onKeyDown={(event) => {
            if (event.key === 'Enter' && valid) onRename(name);
          }}
        />
      </div>
    </Modal>
  );
}
