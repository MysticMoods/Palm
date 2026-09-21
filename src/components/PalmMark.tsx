import { cn } from '../utils/cn';

export interface PalmMarkProps {
  size?: number;
  className?: string;
  /**
   * Draws the trunk, then the fronds outward one at a time. Used on the boot
   * and welcome screens; the taskbar renders it static.
   */
  animated?: boolean;
}

/**
 * The Palm mark.
 *
 * Fronds are filled crescents rather than strokes: a stroked outline collapses
 * into a smudge at taskbar size, while a crescent keeps a readable silhouette
 * from 16px to 64px. Everything uses `currentColor`, so the mark inherits the
 * surrounding text colour.
 */
export function PalmMark({ size = 24, className, animated = false }: PalmMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={cn(animated && 'palm-mark-animated', className)}
    >
      {/* Trunk — leans slightly, as palms do. */}
      <path
        d="M10.75 21.9c-.2-4.3.15-8 1.05-11.5l1.85.5c-.8 3.3-1.1 6.8-.9 11h-2Z"
        fill="currentColor"
        style={{ ['--frond' as string]: 0 }}
      />

      {/* Upper fronds */}
      <path
        d="M12 9.5c1.6-3.1 4.9-4.6 8.6-3.5-2.9.3-5.3 1.8-7.2 4.5L12 9.5Z"
        fill="currentColor"
        style={{ ['--frond' as string]: 1 }}
      />
      <path
        d="M11.7 9.5C10.1 6.4 6.8 4.9 3.1 6c2.9.3 5.3 1.8 7.2 4.5l1.4-1Z"
        fill="currentColor"
        opacity="0.88"
        style={{ ['--frond' as string]: 2 }}
      />

      {/* Crown frond */}
      <path
        d="M11.9 9.2c-.5-3 .5-5.4 3-7-.9 2.3-1.2 4.7-1 7.2l-2-.2Z"
        fill="currentColor"
        opacity="0.8"
        style={{ ['--frond' as string]: 3 }}
      />

      {/* Lower, wider fronds */}
      <path
        d="M12.5 10.6c2.5-2 5.5-2.1 8.6.1-2.8-.5-5.3.1-7.6 1.7l-1-1.8Z"
        fill="currentColor"
        opacity="0.72"
        style={{ ['--frond' as string]: 4 }}
      />
      <path
        d="M11.3 10.6C8.8 8.6 5.8 8.5 2.7 10.7c2.8-.5 5.3.1 7.6 1.7l1-1.8Z"
        fill="currentColor"
        opacity="0.62"
        style={{ ['--frond' as string]: 5 }}
      />

      {/* Coconut cluster at the crown. */}
      <circle cx="12" cy="10.1" r="1.6" fill="currentColor" style={{ ['--frond' as string]: 6 }} />
    </svg>
  );
}
