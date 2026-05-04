import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * ScreenshotRegion - Shows a blue border around the screenshot region with optional label
 */
function ScreenshotRegion() {
  const [regions, setRegions] = useState([]);
  const idCounter = useRef(0);

  const addRegion = useCallback((data) => {
    const id = ++idCounter.current;

    setRegions(prev => [...prev, {
      id,
      region: data.region,
      fullscreen: data.fullscreen,
      label: data.label || null,
      animate: data.animate || false
    }]);

    // Remove after 1 second
    setTimeout(() => {
      setRegions(prev => prev.filter(r => r.id !== id));
    }, 1000);
  }, []);

  useEffect(() => {
    if (!window.overlay?.onScreenshot) return;

    const cleanup = window.overlay.onScreenshot((data) => {
      addRegion(data);
    });

    return cleanup;
  }, [addRegion]);

  if (regions.length === 0) return null;

  return (
    <>
      {regions.map((item) => {
        const animateClass = item.animate ? ' screenshot-region--animate' : '';

        // For fullscreen screenshots, show border around entire screen
        if (item.fullscreen || !item.region) {
          return (
            <div
              key={item.id}
              className={`screenshot-region screenshot-region--visible${animateClass}`}
              style={{
                top: 0,
                left: 0,
                right: 0,
                bottom: 0
              }}
            >
              {item.label && (
                <span className="screenshot-region__label screenshot-region__label--center">
                  {item.label}
                </span>
              )}
            </div>
          );
        }

        // For region screenshots, show border around the region
        const { left, top, width, height } = item.region;
        return (
          <div
            key={item.id}
            className={`screenshot-region screenshot-region--visible${animateClass}`}
            style={{
              left: left,
              top: top,
              width: width,
              height: height
            }}
          >
            {item.label && (
              <span className="screenshot-region__label">
                {item.label}
              </span>
            )}
          </div>
        );
      })}
    </>
  );
}

export default ScreenshotRegion;
