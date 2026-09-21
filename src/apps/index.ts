/**
 * Built-in application catalogue.
 *
 * Every application is registered here and nowhere else — the desktop, the
 * launcher, search and the App Store all read from the registry. Adding an app
 * means writing a manifest and adding one line below.
 */

import { registerApps } from '../core/app-manager/registry';
import { appStoreApp } from './AppStore/manifest';
import { browserApp } from './Browser/manifest';
import { calculatorApp } from './Calculator/manifest';
import { calendarApp } from './Calendar/manifest';
import { filesApp } from './Files/manifest';
import { imageViewerApp } from './ImageViewer/manifest';
import { mediaPlayerApp } from './MediaPlayer/manifest';
import { notesApp } from './Notes/manifest';
import { settingsApp } from './Settings/manifest';
import { systemMonitorApp } from './SystemMonitor/manifest';
import { terminalApp } from './Terminal/manifest';
import { textEditorApp } from './TextEditor/manifest';

let registered = false;

export function registerBuiltInApps(): void {
  if (registered) return;
  registered = true;
  registerApps([
    filesApp,
    settingsApp,
    terminalApp,
    textEditorApp,
    browserApp,
    notesApp,
    calendarApp,
    calculatorApp,
    imageViewerApp,
    mediaPlayerApp,
    systemMonitorApp,
    appStoreApp,
  ]);
}
