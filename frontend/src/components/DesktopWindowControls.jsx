import { useEffect, useState } from 'react';

export function DesktopWindowControls() {
  const api = typeof window !== 'undefined' ? window.akiraDesktop : null;
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    const a = typeof window !== 'undefined' ? window.akiraDesktop : null;
    if (!a?.isAlwaysOnTop) return undefined;
    let cancelled = false;
    a.isAlwaysOnTop().then((v) => {
      if (!cancelled) setPinned(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!api) return null;

  return (
    <div className="sidebar__desktop-controls" role="toolbar" aria-label="Window">
      <button
        type="button"
        className="sidebar__desktop-btn"
        onClick={() => api.minimize()}
        aria-label="Minimize"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M5 12h14" />
        </svg>
      </button>
      <button
        type="button"
        className={`sidebar__desktop-btn${pinned ? ' sidebar__desktop-btn--active' : ''}`}
        onClick={async () => {
          const next = await api.toggleAlwaysOnTop();
          setPinned(next);
        }}
        aria-label={pinned ? 'Allow other windows on top' : 'Keep on top'}
        aria-pressed={pinned}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 17v5M9 10V7a3 3 0 0 1 6 0v3" />
          <rect x="5" y="10" width="14" height="10" rx="2" />
        </svg>
      </button>
      <button
        type="button"
        className="sidebar__desktop-btn sidebar__desktop-btn--close"
        onClick={() => api.close()}
        aria-label="Close"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
