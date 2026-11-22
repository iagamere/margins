import { registerPlugin } from '@capacitor/core';
import { isNative } from './platform';
import { translate } from './i18n';
import { useApp } from '../store/useApp';

/**
 * Notifications for followed shelves, without any server: @capacitor/background-runner runs
 * public/runners/background.js every ~15 minutes (Android decides the exact moment), reads the followed
 * libraries' manifests and shows a notification for every book that is new on a watched shelf.
 * The plugin is reached through registerPlugin, so the app still builds and runs if it is removed.
 */
const LABEL = 'app.margins.reader.check';
const Runner = registerPlugin<{
  dispatchEvent(o: { label: string; event: string; details: Record<string, unknown> }): Promise<unknown>;
  requestPermissions(o: { apis: string[] }): Promise<unknown>;
}>('BackgroundRunner');

export async function runnerSend(event: string, details: Record<string, unknown> = {}): Promise<{ ok: boolean; data?: unknown }> {
  if (!isNative) return { ok: false };
  try {
    return { ok: true, data: await Runner.dispatchEvent({ label: LABEL, event, details }) };
  } catch {
    return { ok: false };
  }
}

export async function askNotifyPermission(): Promise<void> {
  if (!isNative) return;
  try {
    await Runner.requestPermissions({ apis: ['notifications'] });
  } catch {
    /* the plugin reports the result through the system dialog */
  }
}

/** The runner has no DOM and no language: it gets the notification texts from here. */
export function syncRunnerConfig() {
  const lang = useApp.getState().settings.lang;
  void runnerSend('config', {
    one: translate(lang, 'notify.one'),
    many: translate(lang, 'notify.many'),
    key: import.meta.env.VITE_GOOGLE_API_KEY || '',
  });
}

let lastCheck = 0;
export function checkNow(force = false) {
  const now = Date.now();
  if (!force && now - lastCheck < 60_000) return;
  lastCheck = now;
  void runnerSend('checkLibraries');
}

export function startNotifyLoop() {
  if (!isNative) return;
  syncRunnerConfig();
  setTimeout(() => checkNow(true), 6000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && checkNow());
  setInterval(() => checkNow(), 10 * 60 * 1000);
}
