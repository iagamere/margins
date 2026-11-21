import { SocialLogin } from '@capgo/capacitor-social-login';
import { isNative } from './platform';

/** The WEB OAuth client of the Google Cloud project (not the Android one). Public by design. */
export const GOOGLE_WEB_CLIENT_ID = '185167516974-215uss48abl9s48huj8dvmjc81pd9bg0.apps.googleusercontent.com';
/** Private per-app folder in the user's Drive: Margins never sees the rest of their files. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
/** Files the app itself creates in the user's normal Drive: used only for the shared ("stamp") library. */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface Account {
  name: string;
  email: string;
  imageUrl?: string;
  /** Google handed us an access token for Drive (the scope was granted) */
  drive: boolean;
  /** the sharing permission (drive.file) was granted: accounts signed in before it existed must sign in again */
  share?: boolean;
}

const KEY = 'margins.account';

export function loadAccount(): Account | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Account) : null;
  } catch {
    return null;
  }
}

function saveAccount(a: Account | null) {
  try {
    if (a) localStorage.setItem(KEY, JSON.stringify(a));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable: the account simply is not remembered */
  }
}

let ready: Promise<void> | null = null;
export function init(): Promise<void> {
  if (!ready) {
    ready = SocialLogin.initialize({ google: { webClientId: GOOGLE_WEB_CLIENT_ID, mode: 'online' } }).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

/** Optional sign-in. Throws the plugin's own message so the screen can show what went wrong. */
export async function signIn(): Promise<Account> {
  if (!isNative) throw new Error('Google sign-in works in the Android app only.');
  await init();
  const res: any = await SocialLogin.login({ provider: 'google', options: { scopes: [DRIVE_SCOPE, DRIVE_FILE_SCOPE] } });
  const r = res?.result ?? {};
  const p = r.profile ?? {};
  const account: Account = {
    name: p.name || p.givenName || p.email || '',
    email: p.email || '',
    imageUrl: p.imageUrl || undefined,
    drive: !!r.accessToken?.token,
    share: !!r.accessToken?.token,
  };
  saveAccount(account);
  return account;
}

export async function signOut(): Promise<void> {
  saveAccount(null);
  try {
    await init();
    await SocialLogin.logout({ provider: 'google' });
  } catch {
    /* already signed out */
  }
}
