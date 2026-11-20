import { isNative } from './platform';

const REPO = import.meta.env.VITE_GH_REPO;
export const CURRENT_BUILD = Number(import.meta.env.VITE_BUILD_NUMBER || 0);

export interface UpdateInfo {
  build: number;
  url: string;
}

/**
 * Looks at the "latest" GitHub release (the workflow stamps it with `build:<n>` in its notes)
 * and reports it when it is newer than the build that is running. Never throws.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isNative || !REPO || !CURRENT_BUILD) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 10_000);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/tags/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-store',
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    const rel = await res.json();
    const build = Number(/build:\s*(\d+)/i.exec(String(rel.body ?? ''))?.[1] ?? 0);
    const asset = (rel.assets ?? []).find((a: { name?: string }) => /\.apk$/i.test(a.name ?? ''));
    if (!build || !asset?.browser_download_url || build <= CURRENT_BUILD) return null;
    return { build, url: asset.browser_download_url as string };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
