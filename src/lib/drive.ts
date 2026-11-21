import { SocialLogin } from '@capgo/capacitor-social-login';
import { CapacitorHttp } from '@capacitor/core';
import { init } from './auth';
import { isNative } from './platform';

/**
 * Minimal Google Drive client. Everything lives in the hidden per-app folder (appDataFolder):
 * Margins can neither see nor touch the rest of the user's Drive.
 */
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

let cached: { token: string; at: number } | null = null;

/** A valid access token. Google's last one ~1 h, so it is renewed silently through the plugin. */
export async function getToken(force = false): Promise<string> {
  if (!force && cached && Date.now() - cached.at < 45 * 60 * 1000) return cached.token;
  await init();
  let token: string | undefined;
  if (!force) {
    try {
      token = (await SocialLogin.getAuthorizationCode({ provider: 'google' })).accessToken;
    } catch {
      /* fall through to refresh */
    }
  }
  if (!token) {
    try {
      await SocialLogin.refresh({ provider: 'google', options: {} } as any);
      token = (await SocialLogin.getAuthorizationCode({ provider: 'google' })).accessToken;
    } catch {
      /* handled below */
    }
  }
  if (!token) throw new Error('Drive access expired. Sign in again from the Account screen.');
  cached = { token, at: Date.now() };
  return token;
}

export function forgetToken() {
  cached = null;
}

async function authFetch(url: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = await getToken();
  const res = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  if (res.status === 401 && retry) {
    forgetToken();
    await getToken(true);
    return authFetch(url, init, false);
  }
  return res;
}

async function failure(res: Response): Promise<Error> {
  let body = '';
  try {
    body = (await res.text()).slice(0, 200);
  } catch {
    /* ignore */
  }
  return new Error(`Drive ${res.status}${body ? `: ${body}` : ''}`);
}

export interface RemoteFile {
  id: string;
  name: string;
  size?: number;
  description?: string;
  props: Record<string, string>;
  parent?: string;
}

export async function listAppFiles(): Promise<RemoteFile[]> {
  const out: RemoteFile[] = [];
  let pageToken = '';
  do {
    const url = `${API}/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name,size,description,appProperties)${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`;
    const res = await authFetch(url);
    if (!res.ok) throw await failure(res);
    const j = await res.json();
    for (const f of j.files ?? []) out.push({ id: f.id, name: f.name, size: f.size ? Number(f.size) : undefined, description: f.description, props: f.appProperties ?? {} });
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** One multipart upload with real progress (XHR). `description` carries the book's details as JSON. */
export async function uploadFile(name: string, blob: Blob, mime: string, props: Record<string, string>, description: string, onProgress?: (f: number) => void, existingId?: string, parent = 'appDataFolder'): Promise<string> {
  const boundary = 'margins' + Math.random().toString(36).slice(2);
  // an update may not carry `parents`; the name stays as it was
  const meta = JSON.stringify(existingId ? { appProperties: props, description } : { name, parents: [parent], appProperties: props, description });
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, blob, `\r\n--${boundary}--`]);
  const send = (token: string) =>
    new Promise<{ status: number; text: string }>((resolve, reject) => {
      const x = new XMLHttpRequest();
      if (existingId) x.open('PATCH', `${UPLOAD}/files/${existingId}?uploadType=multipart&fields=id`);
      else x.open('POST', `${UPLOAD}/files?uploadType=multipart&fields=id`);
      x.setRequestHeader('Authorization', `Bearer ${token}`);
      x.setRequestHeader('Content-Type', `multipart/related; boundary=${boundary}`);
      x.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      x.onload = () => resolve({ status: x.status, text: x.responseText });
      x.onerror = () => reject(new Error('Network or CORS error while uploading to Drive'));
      x.send(body);
    });
  let r = await send(await getToken());
  if (r.status === 401) {
    forgetToken();
    r = await send(await getToken(true));
  }
  if (r.status < 200 || r.status >= 300) throw new Error(`Drive ${r.status}: ${r.text.slice(0, 200)}`);
  return JSON.parse(r.text).id as string;
}

async function readBody(res: Response, total?: number, onProgress?: (f: number) => void): Promise<Blob> {
  if (!res.body) return res.blob();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      got += value.length;
      if (total) onProgress?.(Math.min(1, got / total));
    }
  }
  return new Blob(chunks as BlobPart[]);
}

export async function downloadFile(id: string, total?: number, onProgress?: (f: number) => void): Promise<Blob> {
  const res = await authFetch(`${API}/files/${id}?alt=media`);
  if (!res.ok) throw await failure(res);
  return readBody(res, total, onProgress);
}

/* ---------- Shared library: normal Drive files that anyone with the stamp may read ---------- */

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || '';

export async function createFolder(name: string): Promise<string> {
  const res = await authFetch(`${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder' }),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()).id as string;
}

/** Everything this app ever put in the user's normal Drive for sharing (survives reinstalls: found again by its tags). */
export async function listSharedFiles(): Promise<RemoteFile[]> {
  const out: RemoteFile[] = [];
  const q = `trashed=false and (${['smanifest', 'sbook', 'scover', 'sshelf'].map((k) => `appProperties has { key='k' and value='${k}' }`).join(' or ')})`;
  let pageToken = '';
  do {
    const res = await authFetch(`${API}/files?pageSize=1000&q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,size,parents,appProperties)${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
    if (!res.ok) throw await failure(res);
    const j = await res.json();
    for (const f of j.files ?? []) out.push({ id: f.id, name: f.name, size: f.size ? Number(f.size) : undefined, props: f.appProperties ?? {}, parent: f.parents?.[0] });
    pageToken = j.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** "Anyone with the link can read" — the file id is the secret. */
export async function makePublic(id: string): Promise<void> {
  const res = await authFetch(`${API}/files/${id}/permissions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'anyone', role: 'reader' }),
  });
  if (!res.ok) throw await failure(res);
}

/** Reads a publicly shared file without signing in (API key when the build has one, else the native HTTP client). */
export async function fetchPublicBlob(id: string, total?: number, onProgress?: (f: number) => void): Promise<Blob> {
  if (API_KEY) {
    const res = await fetch(`${API}/files/${id}?alt=media&key=${API_KEY}`);
    if (!res.ok) throw await failure(res);
    return readBody(res, total, onProgress);
  }
  if (!isNative) throw new Error('Reading a friend’s library needs the Android app.');
  const r = await CapacitorHttp.get({ url: `https://drive.usercontent.google.com/download?id=${encodeURIComponent(id)}&export=download&confirm=t`, responseType: 'blob' });
  if (r.status < 200 || r.status >= 300 || typeof r.data !== 'string') throw new Error(`Drive ${r.status}`);
  onProgress?.(1);
  return await (await fetch(`data:application/octet-stream;base64,${r.data}`)).blob();
}

export async function fetchPublicJson<T>(id: string): Promise<T> {
  if (API_KEY) {
    const res = await fetch(`${API}/files/${id}?alt=media&key=${API_KEY}`);
    if (!res.ok) throw await failure(res);
    return (await res.json()) as T;
  }
  const blob = await fetchPublicBlob(id);
  return JSON.parse(await blob.text()) as T;
}

export async function deleteFile(id: string): Promise<void> {
  const res = await authFetch(`${API}/files/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw await failure(res);
}

/** One file of the app folder by kind (`k`) and, optionally, book hash (`h`). */
export async function findFile(kind: string, hash?: string): Promise<RemoteFile | null> {
  const q = `appProperties has { key='k' and value='${kind}' }` + (hash ? ` and appProperties has { key='h' and value='${hash}' }` : '');
  const res = await authFetch(`${API}/files?spaces=appDataFolder&pageSize=1&q=${encodeURIComponent(q)}&fields=files(id,name,size,description,appProperties)`);
  if (!res.ok) throw await failure(res);
  const f = (await res.json()).files?.[0];
  return f ? { id: f.id, name: f.name, size: f.size ? Number(f.size) : undefined, description: f.description, props: f.appProperties ?? {} } : null;
}
