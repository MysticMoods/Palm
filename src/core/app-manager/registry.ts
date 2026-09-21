/**
 * Application registry.
 *
 * Applications register themselves here rather than being hard-coded into the
 * desktop. Anything that wants to list, launch or resolve an app goes through
 * this module, which is what makes adding a new app a one-file change.
 */

import type { FileCategory } from '../filesystem/mime';
import type { AppDefinition } from './types';

const registry = new Map<string, AppDefinition>();

export function registerApp(definition: AppDefinition): void {
  if (registry.has(definition.id)) {
    console.warn(`[palm/apps] "${definition.id}" is already registered; replacing.`);
  }
  registry.set(definition.id, definition);
}

export function registerApps(definitions: AppDefinition[]): void {
  for (const definition of definitions) registerApp(definition);
}

/**
 * Remove an application from the registry.
 *
 * Only dynamically registered applications are ever unregistered — an archived
 * web application that has been uninstalled. Without this it would keep
 * appearing in search and the start menu until the page was reloaded.
 */
export function unregisterApp(id: string): boolean {
  return registry.delete(id);
}

export function getApp(id: string): AppDefinition | undefined {
  return registry.get(id);
}

export function allApps(): AppDefinition[] {
  return [...registry.values()];
}

/** Everything the launcher should show, sorted alphabetically. */
export function launchableApps(): AppDefinition[] {
  return allApps()
    .filter((app) => !app.hidden)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function appsByCategory(): Array<{ category: string; apps: AppDefinition[] }> {
  const groups = new Map<string, AppDefinition[]>();
  for (const app of launchableApps()) {
    const list = groups.get(app.category) ?? [];
    list.push(app);
    groups.set(app.category, list);
  }
  return [...groups.entries()]
    .map(([category, apps]) => ({ category, apps }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * Apps that can open a given file, best match first.
 * An exact MIME claim beats a category claim.
 */
export function appsForFile(mime: string, category: FileCategory): AppDefinition[] {
  const exact: AppDefinition[] = [];
  const byCategory: AppDefinition[] = [];
  for (const app of allApps()) {
    if (app.handlesMime?.includes(mime)) exact.push(app);
    else if (app.handles?.includes(category)) byCategory.push(app);
  }
  return [...exact, ...byCategory];
}
