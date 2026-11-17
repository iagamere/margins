import { BookOpen, Library, Settings as Cog } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { LogoMark } from './Logo';

const items = [
  { name: 'library', icon: Library, label: 'nav.library' },
  { name: 'continue', icon: BookOpen, label: 'nav.continue' },
  { name: 'settings', icon: Cog, label: 'nav.settings' },
] as const;

function active(route: string) {
  return route === 'details' ? 'library' : route;
}

export function BottomNav() {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const { t } = useT();
  return (
    <nav className="nav" aria-label={t('nav.main')}>
      {items.map(({ name, icon: Icon, label }) => (
        <button key={name} className="nav-item" aria-current={active(route.name) === name ? 'page' : undefined} onClick={() => navigate({ name } as any, { replace: true })}>
          <Icon size={22} aria-hidden="true" />
          <span>{t(label)}</span>
        </button>
      ))}
    </nav>
  );
}

export function SideNav() {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const { t } = useT();
  return (
    <aside className="side" aria-label={t('nav.main')}>
      <div className="brand">
        <LogoMark />
        <span>Margins</span>
      </div>
      {items.map(({ name, icon: Icon, label }) => (
        <button key={name} className="side-item" aria-current={active(route.name) === name ? 'page' : undefined} onClick={() => navigate({ name } as any, { replace: true })}>
          <Icon size={20} aria-hidden="true" />
          <span>{t(label)}</span>
        </button>
      ))}
      <div className="side-foot">{t('app.tagline')}</div>
    </aside>
  );
}
