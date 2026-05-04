import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * CursorIndicator - Shows a circle at mouse click/move locations
 */
function CursorIndicator() {
  const [indicators, setIndicators] = useState([]);
  const idCounter = useRef(0);

  const addIndicator = useCallback((x, y, type) => {
    const id = ++idCounter.current;

    setIndicators(prev => [...prev, {
      id,
      x,
      y,
      type
    }]);

    // Remove after animation completes (1.2s)
    setTimeout(() => {
      setIndicators(prev => prev.filter(i => i.id !== id));
    }, 1200);
  }, []);

  useEffect(() => {
    if (!window.overlay?.onAction) return;

    const cleanup = window.overlay.onAction((action) => {
      // Only show cursor for actions with coordinates
      if (action.x !== undefined && action.y !== undefined) {
        const isClick = ['click', 'double_click', 'right_click', 'middle_click'].includes(action.type);
        addIndicator(action.x, action.y, isClick ? 'click' : 'move');
      }

      // For drag, show indicator at both start and end
      if (action.type === 'drag') {
        if (action.start_x !== undefined && action.start_y !== undefined) {
          addIndicator(action.start_x, action.start_y, 'click');
        }
        if (action.end_x !== undefined && action.end_y !== undefined) {
          setTimeout(() => {
            addIndicator(action.end_x, action.end_y, 'move');
          }, 200);
        }
      }
    });

    return cleanup;
  }, [addIndicator]);

  if (indicators.length === 0) return null;

  return (
    <div className="cursor-indicator">
      {indicators.map((indicator) => (
        <div
          key={indicator.id}
          className={`cursor-indicator__circle cursor-indicator__circle--${indicator.type}`}
          style={{
            left: indicator.x,
            top: indicator.y
          }}
        />
      ))}
    </div>
  );
}

export default CursorIndicator;
