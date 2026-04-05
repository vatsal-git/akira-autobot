import React, { useState, useRef, useEffect } from 'react';

const SHOW_DELAY_MS = 400;
const HIDE_DELAY_MS = 100;

/**
 * Custom tooltip that matches app UI. Shows to the right of the trigger (for sidebar strip).
 * Supports hover and focus for accessibility.
 */
export function Tooltip({ label, children }) {
  const [visible, setVisible] = useState(false);
  const showTimerRef = useRef(null);
  const hideTimerRef = useRef(null);

  const clearShowTimer = () => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  };

  const clearHideTimer = () => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };

  const show = () => {
    clearHideTimer();
    showTimerRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
  };

  const hide = () => {
    clearShowTimer();
    hideTimerRef.current = setTimeout(() => setVisible(false), HIDE_DELAY_MS);
  };

  useEffect(() => {
    return () => {
      clearShowTimer();
      clearHideTimer();
    };
  }, []);

  return (
    <span
      className="tooltip__trigger"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <span
        className={`tooltip__bubble ${visible ? 'tooltip__bubble--visible' : ''}`}
        role="tooltip"
      >
        {label}
      </span>
    </span>
  );
}
