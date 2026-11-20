import { useEffect } from 'react';
import { useApp } from './store/useApp';
import { useT } from './lib/i18n';
import { initBackButton, setSystemBars } from './lib/platform';
import { runTopBackHandler } from './lib/backStack';
import { requestPersistence } from './lib/db';
import { THEME_COLORS } from './lib/readerCss';
import type { ThemeName } from './lib/types';
import { BottomNav, SideNav } from './components/Nav';
import { DropZone } from './components/DropZone';
import { ImportBanner, Toasts } from './components/Toasts';
import { UpdateBanner } from './components/UpdateBanner';
import { LibraryScreen } from './screens/Library';
import { ContinueScreen } from './screens/Continue';
import { DetailsScreen } from './screens/Details';
import { SettingsScreen } from './screens/Settings';
import { ReaderScreen } from './reader/ReaderScreen';

export function App() {
  const { lang, dir } = useT();
  const route = useApp((s) => s.route);
  const themePref = useApp((s) => s.settings.theme);
  const readerTheme = useApp((s) => s.settings.readerTheme);
  const resolved = useApp((s) => s.resolvedTheme);
  const setResolvedTheme = useApp((s) => s.setResolvedTheme);

  useEffect(() => {
    void useApp.getState().init();
    void requestPersistence();
    initBackButton(() => {
      if (runTopBackHandler()) return true;
      const st = useApp.getState();
      if (st.route.name === 'reader' || st.route.name === 'details') {
        if (!st.back()) st.navigate({ name: 'library' }, { replace: true });
        return true;
      }
      if (st.route.name !== 'library') {
        st.navigate({ name: 'library' }, { replace: true });
        return true;
      }
      return false;
    });
  }, []);

  // Language → <html lang dir>, applied immediately.
  useEffect(() => {
    const r = document.documentElement;
    r.lang = lang;
    r.dir = dir;
  }, [lang, dir]);

  // Theme → <html data-theme>, following the system when asked to.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const t: ThemeName = themePref === 'system' ? (mq.matches ? 'dark' : 'light') : themePref;
      document.documentElement.setAttribute('data-theme', t);
      setResolvedTheme(t);
    };
    apply();
    mq.addEventListener?.('change', apply);
    return () => mq.removeEventListener?.('change', apply);
  }, [themePref, setResolvedTheme]);

  // System bars follow whatever surface is on screen.
  const barTheme: ThemeName = route.name === 'reader' ? (readerTheme === 'auto' ? resolved : readerTheme) : resolved;
  useEffect(() => {
    void setSystemBars(barTheme === 'dark', THEME_COLORS[barTheme].bg);
  }, [barTheme]);

  if (route.name === 'reader') {
    return (
      <>
        <ReaderScreen key={route.id} id={route.id} />
        <Toasts inReader />
      </>
    );
  }

  return (
    <div className="shell">
      <SideNav />
      <div className="shell-body">
        {route.name === 'library' && <LibraryScreen />}
        {route.name === 'continue' && <ContinueScreen />}
        {route.name === 'settings' && <SettingsScreen />}
        {route.name === 'details' && <DetailsScreen id={route.id} />}
        <BottomNav />
      </div>
      <DropZone />
      <ImportBanner />
      <UpdateBanner />
      <Toasts />
    </div>
  );
}
