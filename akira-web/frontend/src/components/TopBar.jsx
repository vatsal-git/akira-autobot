import React from 'react';

export function TopBar() {
  return (
    <header className="topbar" role="banner">
      <div className="topbar__avatar" aria-hidden>
        <span className="topbar__avatar-circle" />
      </div>
      <div className="topbar__right">
        <button
          type="button"
          className="topbar__toggle"
          aria-label="Toggle setting"
          title="Toggle"
        >
          <span className="topbar__toggle-dot" />
        </button>
        <button type="button" className="topbar__pro" aria-label="Get Pro">
          Get Pro
        </button>
      </div>
    </header>
  );
}
