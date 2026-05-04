import React, { useState, useEffect, useCallback, useRef } from 'react';

/**
 * ToolIndicator - Shows the currently executing tool name
 */
function ToolIndicator() {
  const [tools, setTools] = useState([]);
  const idCounter = useRef(0);

  const addTool = useCallback((info) => {
    const id = ++idCounter.current;

    setTools(prev => [...prev, {
      id,
      name: info.name,
      status: info.status,
      success: info.success
    }]);

    // Remove after animation completes (1.5 seconds)
    setTimeout(() => {
      setTools(prev => prev.filter(t => t.id !== id));
    }, 1500);
  }, []);

  useEffect(() => {
    if (!window.overlay?.onTool) return;

    const cleanup = window.overlay.onTool((info) => {
      addTool(info);
    });

    return cleanup;
  }, [addTool]);

  // Format tool name for display
  const formatToolName = (name) => {
    // Remove 'desktop_' prefix if present
    const cleanName = name.replace(/^desktop_/, '');
    // Convert snake_case to Title Case
    return cleanName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  if (tools.length === 0) return null;

  return (
    <div className="tool-indicator">
      {tools.map((tool) => {
        let statusClass = '';
        if (tool.status === 'complete') {
          statusClass = tool.success !== false ? 'tool-indicator__item--success' : 'tool-indicator__item--error';
        }

        return (
          <div
            key={tool.id}
            className={`tool-indicator__item ${statusClass}`}
          >
            <span className="tool-indicator__dot" />
            <span>{formatToolName(tool.name)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default ToolIndicator;
