import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { Segmented } from '../../components/ui/Field';
import type { AppProps } from '../../core/app-manager/types';
import { useOS } from '../../desktop/app-context';
import { cn } from '../../utils/cn';
import { CalculationError, calculate, formatResult } from './engine';

interface HistoryEntry {
  id: string;
  expression: string;
  result: string;
}

type Mode = 'basic' | 'scientific';

const BASIC_KEYS: Array<{ label: string; insert?: string; action?: string; variant?: string; span?: number }> = [
  { label: 'C', action: 'clear', variant: 'accent' },
  { label: '( )', action: 'paren', variant: 'muted' },
  { label: '%', insert: '%', variant: 'muted' },
  { label: '÷', insert: '/', variant: 'muted' },
  { label: '7', insert: '7' },
  { label: '8', insert: '8' },
  { label: '9', insert: '9' },
  { label: '×', insert: '*', variant: 'muted' },
  { label: '4', insert: '4' },
  { label: '5', insert: '5' },
  { label: '6', insert: '6' },
  { label: '−', insert: '-', variant: 'muted' },
  { label: '1', insert: '1' },
  { label: '2', insert: '2' },
  { label: '3', insert: '3' },
  { label: '+', insert: '+', variant: 'muted' },
  { label: '±', action: 'negate' },
  { label: '0', insert: '0' },
  { label: '.', insert: '.' },
  { label: '=', action: 'equals', variant: 'primary' },
];

const SCIENTIFIC_KEYS: Array<{ label: string; insert: string }> = [
  { label: 'sin', insert: 'sin(' },
  { label: 'cos', insert: 'cos(' },
  { label: 'tan', insert: 'tan(' },
  { label: 'ln', insert: 'ln(' },
  { label: 'log', insert: 'log(' },
  { label: '√', insert: 'sqrt(' },
  { label: '∛', insert: 'cbrt(' },
  { label: 'x²', insert: '^2' },
  { label: 'xʸ', insert: '^' },
  { label: 'eˣ', insert: 'exp(' },
  { label: 'π', insert: 'pi' },
  { label: 'e', insert: 'e' },
];

export default function CalculatorApp(_props: AppProps) {
  const { os } = useOS();
  const [expression, setExpression] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [mode, setMode] = useState<Mode>('basic');
  const [degrees, setDegrees] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  /* ------------------------------ Persistence ----------------------------- */

  useEffect(() => {
    let cancelled = false;
    void os.storage.get<HistoryEntry[]>('history', []).then((stored) => {
      if (!cancelled && Array.isArray(stored)) setHistory(stored);
    });
    void os.storage.get<Mode>('mode').then((stored) => {
      if (!cancelled && stored) setMode(stored);
    });
    void os.storage.get<boolean>('degrees').then((stored) => {
      if (!cancelled && typeof stored === 'boolean') setDegrees(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [os]);

  useEffect(() => {
    void os.storage.set('mode', mode);
  }, [mode, os]);
  useEffect(() => {
    void os.storage.set('degrees', degrees);
  }, [degrees, os]);

  const persistHistory = useCallback(
    (entries: HistoryEntry[]) => {
      setHistory(entries);
      void os.storage.set('history', entries.slice(0, 60));
    },
    [os],
  );

  /* ------------------------------ Live preview ---------------------------- */

  useEffect(() => {
    // Editing the expression always clears the previous result's error: it
    // referred to something the user has since changed.
    setError(null);
    if (expression.trim().length === 0) {
      setPreview('');
      return;
    }
    try {
      setPreview(formatResult(calculate(expression, degrees)));
    } catch {
      // A half-typed expression is not an error yet — stay quiet until "=".
      setPreview('');
    }
  }, [expression, degrees]);

  /* -------------------------------- Actions ------------------------------- */

  const insert = useCallback((text: string) => {
    setExpression((current) => current + text);
    setError(null);
    inputRef.current?.focus();
  }, []);

  const evaluate = useCallback(() => {
    if (expression.trim().length === 0) return;
    try {
      const value = calculate(expression, degrees);
      const formatted = formatResult(value);
      persistHistory([
        { id: `${Date.now()}`, expression: expression.trim(), result: formatted },
        ...history,
      ].slice(0, 60));
      setExpression(formatted);
      setPreview('');
      setError(null);
    } catch (err) {
      setError(err instanceof CalculationError ? err.message : 'That expression could not be calculated');
    }
  }, [degrees, expression, history, persistHistory]);

  const pressKey = useCallback(
    (key: (typeof BASIC_KEYS)[number]) => {
      if (key.insert) {
        insert(key.insert);
        return;
      }
      switch (key.action) {
        case 'clear':
          setExpression('');
          setPreview('');
          setError(null);
          break;
        case 'equals':
          evaluate();
          break;
        case 'negate':
          setExpression((current) =>
            current.startsWith('-') ? current.slice(1) : current ? `-${current}` : '-',
          );
          break;
        case 'paren': {
          // Insert whichever bracket balances the expression so far.
          const opens = (expression.match(/\(/g) ?? []).length;
          const closes = (expression.match(/\)/g) ?? []).length;
          insert(opens > closes && /[\d)]$/.test(expression) ? ')' : '(');
          break;
        }
      }
    },
    [evaluate, expression, insert],
  );

  /* ------------------------------- Keyboard ------------------------------- */

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === '=') {
      event.preventDefault();
      evaluate();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setExpression('');
      setError(null);
    }
  };

  const copyResult = async () => {
    const value = preview || expression;
    if (!value) return;
    await os.clipboard.writeText(value).catch(() => undefined);
  };

  const keys = useMemo(() => BASIC_KEYS, []);

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* -------------------------------- Header ------------------------------- */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-edge/8 px-3 py-2">
        <Segmented
          size="sm"
          label="Calculator mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'basic', label: 'Basic' },
            { value: 'scientific', label: 'Scientific' },
          ]}
        />
        <div className="flex items-center gap-1">
          {mode === 'scientific' ? (
            <button
              type="button"
              onClick={() => setDegrees(!degrees)}
              aria-pressed={degrees}
              title="Toggle between degrees and radians"
              className={cn(
                'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
                degrees ? 'bg-accent-soft text-accent-ink' : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
              )}
            >
              {degrees ? 'DEG' : 'RAD'}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            aria-pressed={showHistory}
            aria-label="Toggle calculation history"
            title="History"
            className={cn(
              'rounded-md p-1.5 transition-colors',
              showHistory ? 'bg-accent-soft text-accent-ink' : 'text-ink-3 hover:bg-surface-2 hover:text-ink',
            )}
          >
            <Icon name="History" size={15} />
          </button>
        </div>
      </div>

      {showHistory ? (
        <div className="os-scroll max-h-40 shrink-0 overflow-y-auto border-b border-edge/8 bg-surface-2/40">
          {history.length === 0 ? (
            <EmptyState compact icon="History" title="No calculations yet" />
          ) : (
            <>
              <ul className="p-1.5">
                {history.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setExpression(entry.expression);
                        inputRef.current?.focus();
                      }}
                      className="w-full rounded-md px-2 py-1.5 text-right transition-colors hover:bg-surface-3"
                    >
                      <span className="block truncate font-mono text-[11px] text-ink-3">
                        {entry.expression}
                      </span>
                      <span className="block truncate font-mono text-[13px] text-ink">= {entry.result}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-edge/8 p-1.5">
                <Button size="sm" variant="ghost" icon="Trash2" fullWidth onClick={() => persistHistory([])}>
                  Clear history
                </Button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* -------------------------------- Display ------------------------------ */}
      <div className="shrink-0 px-4 pb-3 pt-4">
        <input
          ref={inputRef}
          value={expression}
          onChange={(event) => setExpression(event.target.value)}
          onKeyDown={onKeyDown}
          inputMode="text"
          spellCheck={false}
          autoComplete="off"
          aria-label="Expression"
          aria-invalid={error ? true : undefined}
          aria-describedby="calc-result"
          placeholder="0"
          className={cn(
            'w-full bg-transparent text-right font-mono text-[28px] leading-tight text-ink outline-none',
            'placeholder:text-ink-3',
          )}
        />
        <p
          id="calc-result"
          aria-live="polite"
          className={cn(
            'mt-1 h-5 text-right font-mono text-[13px]',
            error ? 'text-danger' : 'text-ink-3',
          )}
        >
          {error ? error : preview ? `= ${preview}` : ''}
        </p>
      </div>

      {/* --------------------------------- Keys -------------------------------- */}
      <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {mode === 'scientific' ? (
          <div className="mb-2 grid grid-cols-6 gap-1.5">
            {SCIENTIFIC_KEYS.map((key) => (
              <button
                key={key.label}
                type="button"
                onClick={() => insert(key.insert)}
                className="h-9 rounded-lg bg-surface-2 text-[12px] font-medium text-ink-2 transition-colors hover:bg-surface-3 hover:text-ink active:brightness-95"
              >
                {key.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="grid grid-cols-4 gap-1.5">
          {keys.map((key) => (
            <button
              key={key.label}
              type="button"
              onClick={() => pressKey(key)}
              aria-label={key.label === '±' ? 'Negate' : key.label === '( )' ? 'Bracket' : key.label}
              className={cn(
                'h-12 rounded-lg text-[16px] font-medium transition-[background-color,filter] duration-100 active:brightness-95',
                key.variant === 'primary'
                  ? 'bg-accent text-accent-fg hover:brightness-110'
                  : key.variant === 'accent'
                    ? 'bg-danger/15 text-danger hover:bg-danger/25'
                    : key.variant === 'muted'
                      ? 'bg-surface-3 text-ink hover:brightness-110'
                      : 'bg-surface-2 text-ink hover:bg-surface-3',
              )}
            >
              {key.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-edge/8 px-3 py-2">
        <span className="text-[11px] text-ink-3">Type directly, or use the keypad</span>
        <Button size="sm" variant="ghost" icon="Copy" onClick={copyResult} disabled={!preview && !expression}>
          Copy
        </Button>
      </div>
    </div>
  );
}
