import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '../lib/i18n';
import { openExternal } from '../lib/platform';
import { checkForUpdate, type UpdateInfo } from '../lib/updater';

const DISMISS_KEY = 'margins:updateDismissed';
const RECHECK_MS = 20 * 60 * 1000;

export function UpdateBanner() {
  const { t } = useT();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const lastCheck = useRef(0);

  useEffect(() => {
    const run = async () => {
      if (Date.now() - lastCheck.current < RECHECK_MS) return;
      lastCheck.current = Date.now();
      const u = await checkForUpdate();
      let dismissed = 0;
      try {
        dismissed = Number(localStorage.getItem(DISMISS_KEY) || 0);
      } catch {
        /* ignore */
      }
      setInfo(u && u.build > dismissed ? u : null);
    };
    void run();
    const onVis = () => document.visibilityState === 'visible' && void run();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  if (!info) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(info.build));
    } catch {
      /* ignore */
    }
    setInfo(null);
  };
  return (
    <div className="update-banner" role="status">
      <span>{t('update.available')}</span>
      <button className="btn btn-primary" onClick={() => void openExternal(info.url)}>{t('update.action')}</button>
      <button className="icon-btn" onClick={dismiss} aria-label={t('update.later')}><X size={18} /></button>
    </div>
  );
}
