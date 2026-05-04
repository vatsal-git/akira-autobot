import React, { useState, useEffect } from 'react';
import ScreenBorder from './components/ScreenBorder';
import ActionText from './components/ActionText';
import CursorIndicator from './components/CursorIndicator';
import ToolIndicator from './components/ToolIndicator';
import ScreenshotRegion from './components/ScreenshotRegion';
import './styles/overlay.css';

/**
 * OverlayApp - Main overlay application component
 * Displays visual feedback during desktop automation
 */
function OverlayApp() {
  const [agentActive, setAgentActive] = useState(false);
  const [screenshotActive, setScreenshotActive] = useState(false);

  useEffect(() => {
    if (!window.overlay) {
      console.warn('Overlay API not available');
      return;
    }

    // Listen for border state changes
    const borderCleanup = window.overlay.onBorder?.((data) => {
      if (data.type === 'agent') {
        setAgentActive(data.active);
      }
    });

    // Listen for screenshot events to show blue border
    const screenshotCleanup = window.overlay.onScreenshot?.((data) => {
      setScreenshotActive(true);
      // Reset after animation
      setTimeout(() => setScreenshotActive(false), 1000);
    });

    // Listen for hide all command
    const hideAllCleanup = window.overlay.onHideAll?.(() => {
      setAgentActive(false);
      setScreenshotActive(false);
    });

    return () => {
      if (borderCleanup) borderCleanup();
      if (screenshotCleanup) screenshotCleanup();
      if (hideAllCleanup) hideAllCleanup();
    };
  }, []);

  return (
    <div className="overlay-container">
      <ScreenBorder
        agentActive={agentActive}
        screenshotActive={screenshotActive}
      />
      <ScreenshotRegion />
      <CursorIndicator />
      <ActionText />
      <ToolIndicator />
    </div>
  );
}

export default OverlayApp;
