import type { ReactNode } from 'react';
import { cn } from '../../utils/cn';

/** A titled group of related settings. */
export function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mb-6 last:mb-0', className)}>
      <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-3">{description}</p> : null}
      <div className="mt-2.5 rounded-xl border border-edge/10 bg-surface-2/40">{children}</div>
    </section>
  );
}

/** One row inside a `Section`. */
export function Row({
  label,
  description,
  control,
  children,
  stacked = false,
}: {
  label?: string;
  description?: string;
  control?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className="border-b border-edge/8 px-3.5 py-3 last:border-b-0">
      <div
        className={cn(
          'gap-4',
          stacked ? 'flex flex-col' : 'flex flex-wrap items-center justify-between',
        )}
      >
        {label ? (
          <div className="min-w-0">
            <p className="text-[13px] text-ink">{label}</p>
            {description ? (
              <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-3">{description}</p>
            ) : null}
          </div>
        ) : null}
        {control ? <div className="shrink-0">{control}</div> : null}
      </div>
      {children ? <div className={label ? 'mt-3' : ''}>{children}</div> : null}
    </div>
  );
}

/** Read-only key/value list for system information. */
export function InfoList({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl>
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex flex-wrap items-baseline justify-between gap-4 border-b border-edge/8 px-3.5 py-2.5 last:border-b-0"
        >
          <dt className="shrink-0 text-[12.5px] text-ink-2">{label}</dt>
          <dd className="min-w-0 break-words text-right text-[12.5px] text-ink-3">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
