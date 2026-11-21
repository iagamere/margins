import { UserRound } from 'lucide-react';
import { useApp } from '../store/useApp';
import { useT } from '../lib/i18n';
import { isNative } from '../lib/platform';

/** Top-of-library account icon: the initial of the signed-in user + a sync dot (green = in sync, pulsing = moving books). */
export function AccountButton() {
  const { t } = useT();
  const account = useApp((s) => s.account);
  const busy = useApp((s) => s.syncing || Object.keys(s.transfers).length > 0);
  const navigate = useApp((s) => s.navigate);
  if (!isNative) return null;
  const initial = account ? (account.name || account.email || '?').trim().charAt(0).toUpperCase() : '';
  const label = account ? `${t('account.title')}: ${account.name || account.email}` : t('account.signIn');
  return (
    <button className="acc-btn" onClick={() => navigate({ name: 'account' })} aria-label={label} title={label}>
      <span className={'acc-avatar' + (account ? '' : ' off')} aria-hidden="true">{account ? initial : <UserRound size={19} strokeWidth={1.8} />}</span>
      {account && <i className={'acc-dot' + (busy ? ' busy' : '')} aria-hidden="true" />}
    </button>
  );
}
