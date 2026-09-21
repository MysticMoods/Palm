import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/icons';
import { Select, TextField } from '../../components/ui/Field';
import { EmptyState } from '../../components/ui/Feedback';
import type { AppProps } from '../../core/app-manager/types';
import { SETTINGS_SECTIONS, findSection } from '../../core/settings/sections';
import { useIsNarrow } from '../../hooks/useElementWidth';
import { useOS } from '../../desktop/app-context';
import { cn } from '../../utils/cn';
import { matches } from '../../utils/misc';
import { AppsSection } from './sections/Apps';
import {
  AccessibilitySection,
  AccountSection,
  DisplaySection,
  NetworkSection,
  NotificationsSection,
  SoundSection,
} from './sections/Misc';
import { PersonalizationSection } from './sections/Personalization';
import { PrivacySection } from './sections/Privacy';
import { StorageSection } from './sections/Storage';
import { SystemSection } from './sections/System';

const RENDERERS: Record<string, () => React.ReactElement> = {
  personalization: PersonalizationSection,
  display: DisplaySection,
  sound: SoundSection,
  network: NetworkSection,
  notifications: NotificationsSection,
  apps: AppsSection,
  storage: StorageSection,
  privacy: PrivacySection,
  accessibility: AccessibilitySection,
  accounts: AccountSection,
  system: SystemSection,
};

export default function SettingsApp({ params }: AppProps<{ section?: string }>) {
  const { os } = useOS();
  const [active, setActive] = useState(() => findSection(params?.section).id);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const narrow = useIsNarrow(rootRef, 620);

  useEffect(() => {
    if (params?.section) setActive(findSection(params.section).id);
  }, [params?.section]);

  const section = findSection(active);

  useEffect(() => {
    os.window.setTitle(`${section.label} — Settings`);
  }, [os, section.label]);

  const visibleSections = useMemo(() => {
    const needle = query.trim();
    if (!needle) return SETTINGS_SECTIONS;
    return SETTINGS_SECTIONS.filter(
      (candidate) =>
        matches(candidate.label, needle) ||
        matches(candidate.description, needle) ||
        candidate.keywords.some((keyword) => matches(keyword, needle)),
    );
  }, [query]);

  const Renderer = RENDERERS[section.id];

  return (
    <div ref={rootRef} className="flex h-full min-h-0">
      {/* -------------------------------- Sidebar ------------------------------ */}
      <nav
        aria-label="Settings sections"
        className={cn(
          'w-52 shrink-0 flex-col border-r border-edge/8 bg-surface-2/30',
          narrow ? 'hidden' : 'flex',
        )}
      >
        <div className="shrink-0 p-2">
          <TextField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a setting"
            label="Find a setting"
            hideLabel
            icon="Search"
            className="[&_input]:h-8 [&_input]:text-[12px]"
          />
        </div>

        <ul className="os-scroll min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {visibleSections.map((candidate) => (
            <li key={candidate.id}>
              <button
                type="button"
                onClick={() => setActive(candidate.id)}
                aria-current={candidate.id === active ? 'page' : undefined}
                className={cn(
                  'mb-px flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                  candidate.id === active
                    ? 'bg-accent-soft font-medium text-accent-ink'
                    : 'text-ink-2 hover:bg-surface-3 hover:text-ink',
                )}
              >
                <Icon name={candidate.icon} size={15} />
                <span className="min-w-0 flex-1 truncate text-[12.5px]">{candidate.label}</span>
              </button>
            </li>
          ))}
          {visibleSections.length === 0 ? (
            <li className="px-2 py-4 text-center text-[12px] text-ink-3">No matching settings</li>
          ) : null}
        </ul>
      </nav>

      {/* -------------------------------- Content ------------------------------ */}
      <div className="os-scroll min-w-0 flex-1 overflow-y-auto">
        <header className="sticky top-0 z-10 border-b border-edge/8 bg-surface/85 backdrop-blur">
          <div className="mx-auto max-w-2xl px-5 py-3.5">
            {narrow ? (
              <div className="mb-3">
                <Select
                  label="Settings section"
                  hideLabel
                  value={active}
                  onChange={(event) => setActive(event.target.value)}
                  options={SETTINGS_SECTIONS.map((entry) => ({ value: entry.id, label: entry.label }))}
                />
              </div>
            ) : null}
            <h1 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
              <Icon name={section.icon} size={18} />
              {section.label}
            </h1>
            <p className="mt-0.5 text-[12px] text-ink-3">{section.description}</p>
          </div>
        </header>

        <div className="mx-auto max-w-2xl px-5 py-5">
          {Renderer ? (
            <Renderer />
          ) : (
            <EmptyState icon="Wrench" title="Not available" description="This section has no settings yet." />
          )}
        </div>
      </div>
    </div>
  );
}
