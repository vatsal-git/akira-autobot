import React, { useState, useEffect, useCallback } from 'react';

/**
 * ActionText - Displays action text in the center of the screen with fade animation
 */
function ActionText() {
  const [actions, setActions] = useState([]);
  let actionIdCounter = 0;

  const formatAction = useCallback((action) => {
    switch (action.type) {
      case 'click':
        const button = action.button || 'left';
        return `${button.charAt(0).toUpperCase() + button.slice(1)} click at (${action.x}, ${action.y})`;
      case 'double_click':
        return `Double click at (${action.x}, ${action.y})`;
      case 'right_click':
        return `Right click at (${action.x}, ${action.y})`;
      case 'middle_click':
        return `Middle click at (${action.x}, ${action.y})`;
      case 'move':
        return `Move to (${action.x}, ${action.y})`;
      case 'type':
        const text = action.text || '';
        const displayText = text.length > 30 ? text.substring(0, 30) + '...' : text;
        return `Type: "${displayText}"`;
      case 'key':
        return `Press: ${action.key || action.text}`;
      case 'hotkey':
        const keys = action.keys || [];
        return `Hotkey: ${keys.join(' + ')}`;
      case 'scroll':
        const direction = (action.amount || 0) > 0 ? 'up' : 'down';
        return `Scroll ${direction}`;
      case 'drag':
        return `Drag from (${action.start_x}, ${action.start_y}) to (${action.end_x}, ${action.end_y})`;
      default:
        return `Action: ${action.type}`;
    }
  }, []);

  const addAction = useCallback((action) => {
    const id = ++actionIdCounter;
    const formattedText = formatAction(action);

    setActions(prev => [...prev, {
      id,
      text: formattedText,
      type: action.type
    }]);

    // Remove after animation completes (2 seconds)
    setTimeout(() => {
      setActions(prev => prev.filter(a => a.id !== id));
    }, 2000);
  }, [formatAction]);

  useEffect(() => {
    if (!window.overlay?.onAction) return;

    const cleanup = window.overlay.onAction((action) => {
      addAction(action);
    });

    return cleanup;
  }, [addAction]);

  // Get CSS class for action type
  const getTypeClass = (type) => {
    if (['click', 'double_click', 'right_click', 'middle_click'].includes(type)) {
      return 'action-text__item--click';
    }
    if (type === 'move') return 'action-text__item--move';
    if (type === 'type') return 'action-text__item--type';
    if (['key', 'hotkey'].includes(type)) return 'action-text__item--key';
    if (type === 'scroll') return 'action-text__item--scroll';
    if (type === 'drag') return 'action-text__item--drag';
    return '';
  };

  if (actions.length === 0) return null;

  return (
    <div className="action-text">
      {actions.map((action) => (
        <div
          key={action.id}
          className={`action-text__item ${getTypeClass(action.type)}`}
        >
          {action.text}
        </div>
      ))}
    </div>
  );
}

export default ActionText;
