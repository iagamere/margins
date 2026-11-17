import * as core from '@capacitor/core';
import { App } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = core.Capacitor.isNativePlatform();

/** Colours the system bars to match the active theme. Best effort — never throws. */
export async function setSystemBars(dark: boolean, bg: string) {
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', bg);
  if (!isNative) return;
  try {
    const SB = (core as any)['SystemBars'] ?? core.registerPlugin('SystemBars');
    await SB?.setStyle?.({ style: dark ? 'DARK' : 'LIGHT' });
  } catch {
    /* plugin not available on this Capacitor version */
  }
  try {
    await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    await StatusBar.setBackgroundColor({ color: bg });
  } catch {
    /* not supported (e.g. edge-to-edge) */
  }
}

/** Registers the Android hardware back button. `handler` returns true when it consumed the event. */
export function initBackButton(handler: () => boolean, onExit?: () => void) {
  if (!isNative) return;
  App.addListener('backButton', () => {
    if (handler()) return;
    if (onExit) onExit();
    else App.exitApp();
  });
}

export function onAppPause(cb: () => void) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') cb();
  });
  window.addEventListener('pagehide', cb);
}

import { Browser } from '@capacitor/browser';

export async function openExternal(url: string) {
  try {
    if (isNative) await Browser.open({ url });
    else window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
