import { memo } from 'react';
import { Wallpaper } from '../Desktop/Wallpaper';

/**
 * The full-screen backdrop behind the welcome card.
 *
 * It renders the *live* wallpaper, so choosing one during setup previews it at
 * full size rather than in a swatch. Three slow-drifting colour fields sit on
 * top to give a flat gradient some depth, and a vignette guarantees the card
 * has something to sit against whichever wallpaper is picked.
 *
 * All of it is decorative, and the drift stops under `prefers-reduced-motion`.
 */
export const WelcomeBackdrop = memo(function WelcomeBackdrop() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <Wallpaper />

      <div
        className="aurora-a absolute -left-[20%] -top-[30%] h-[85vmax] w-[85vmax] rounded-full opacity-70 blur-[80px]"
        style={{
          background: 'radial-gradient(circle at 35% 35%, rgb(var(--os-accent) / 0.8), transparent 60%)',
        }}
      />
      <div
        className="aurora-b absolute -bottom-[35%] -right-[20%] h-[75vmax] w-[75vmax] rounded-full opacity-55 blur-[100px]"
        style={{
          background: 'radial-gradient(circle at 55% 45%, rgb(var(--os-accent) / 0.55), transparent 58%)',
        }}
      />
      <div
        className="aurora-a absolute -bottom-[10%] left-[15%] h-[45vmax] w-[45vmax] rounded-full opacity-40 blur-[90px]"
        style={{
          animationDirection: 'reverse',
          background: 'radial-gradient(circle, rgb(255 255 255 / 0.35), transparent 62%)',
        }}
      />

      {/* Fine grain stops the large blurred fields from banding on wide gamuts. */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='120' height='120' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,rgb(0_0_0/0.55)_100%)]" />
    </div>
  );
});
