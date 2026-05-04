import React from 'react';

/**
 * ScreenBorder - Renders a colored border around the screen edge
 *
 * @param {Object} props
 * @param {boolean} props.agentActive - Whether agent is actively working
 * @param {boolean} props.screenshotActive - Whether screenshot is being captured
 */
function ScreenBorder({ agentActive, screenshotActive }) {
  const isVisible = agentActive || screenshotActive;

  let borderClass = 'screen-border';
  if (isVisible) {
    borderClass += ' screen-border--visible';
    if (screenshotActive) {
      borderClass += ' screen-border--screenshot';
    } else if (agentActive) {
      borderClass += ' screen-border--agent';
    }
  }

  return <div className={borderClass} />;
}

export default ScreenBorder;
