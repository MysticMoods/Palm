import { resolveIcon } from './icon-registry';

export interface IconProps {
  name: string;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/**
 * Renders a registered icon by name.
 *
 * Decorative by default: icons here always accompany a text label or sit
 * inside a control that carries its own accessible name.
 *
 * `resolveIcon` returns a module-level constant from a fixed map, so the
 * component identity is stable for a given name and React reconciles it
 * normally.
 */
export function Icon({ name, size = 16, className, strokeWidth = 2 }: IconProps) {
  const Component = resolveIcon(name);
  return <Component size={size} className={className} strokeWidth={strokeWidth} aria-hidden="true" />;
}
