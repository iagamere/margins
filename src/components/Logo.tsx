export function LogoMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M6 24V8l10 9.5L26 8v16" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 5v22M29 5v22" stroke="var(--accent2)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
