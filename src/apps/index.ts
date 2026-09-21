/**
 * Built-in application catalogue.
 *
 * Every application is registered here and nowhere else — the desktop, the
 * launcher, search and the App Store all read from the registry. Adding an app
 * means adding a manifest and one line below.
 */

import { registerApps } from '../core/app-manager/registry';
import { filesApp } from './Files/manifest';

let registered = false;

export function registerBuiltInApps(): void {
  if (registered) return;
  registered = true;
  registerApps([filesApp]);
}
