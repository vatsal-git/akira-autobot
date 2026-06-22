import React, { useState } from 'react';
import '../styles/agent-activity.css';

// Agent icons/colors mapping
const agentConfig = {
  orchestrator: { color: '#f59e0b', icon: '' },
  file: { color: '#10b981', icon: '' },
  system: { color: '#ef4444', icon: '' },
  web: { color: '#3b82f6', icon: '' },
  memory: { color: '#8b5cf6', icon: '' },
  desktop: { color: '#ec4899', icon: '' }
};

function AgentActivityChip({ activity, isConnected }) {
  const [expanded, setExpanded] = useState(false);
  const config = agentConfig[activity.agent] || { color: '#6b7280', icon: '' };

  const isRunning = activity.status === 'running';
  const isError = activity.status === 'error';
  const isDelegation = activity.type === 'delegation';
  const dotClass = isRunning
    ? 'trail-item__dot--running'
    : isError
      ? 'trail-item__dot--error'
      : 'trail-item__dot--completed';

  return (
    <div className={`trail-item ${isConnected ? 'trail-item--connected' : ''}`}>
      <div className="trail-item__line" />
      <div className={`trail-item__dot ${dotClass}`} />
      <div className="trail-item__content">
        <div className="trail-item__header" onClick={() => setExpanded(!expanded)}>
          <span className="trail-item__name">
            <span className="trail-item__icon">{config.icon}</span>
            {activity.displayName || activity.agent}
            {isDelegation && activity.fromAgent && (
              <span className="trail-item__agent">
                ← {agentConfig[activity.fromAgent]?.icon || ''} {activity.fromAgent}
              </span>
            )}
          </span>
          {activity.task && (
            <span className={`trail-item__chevron ${expanded ? 'trail-item__chevron--open' : ''}`}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
          )}
        </div>
        {expanded && (activity.task || activity.error) && (
          <div className="trail-item__dropdown">
            {activity.task && (
              <div className="trail-item__section">
                <span className="trail-item__label">Task</span>
                <div className="trail-item__text">{activity.task}</div>
              </div>
            )}
            {activity.error && (
              <div className="trail-item__section">
                <span className="trail-item__label" style={{ color: '#ef4444' }}>Error</span>
                <div className="trail-item__text" style={{ color: '#ef4444' }}>{activity.error}</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Delegation arrow component for showing agent flow
function AgentDelegationChip({ delegation, isConnected }) {
  const fromConfig = agentConfig[delegation.fromAgent] || { color: '#6b7280', icon: '' };
  const toConfig = agentConfig[delegation.toAgent] || { color: '#6b7280', icon: '' };
  const isReturn = delegation.isReturn;

  return (
    <div className={`trail-item ${isConnected ? 'trail-item--connected' : ''} ${isReturn ? 'trail-item--return' : ''}`}>
      <div className="trail-item__line" />
      <div className={`trail-item__dot ${isReturn ? 'trail-item__dot--return' : 'trail-item__dot--completed'}`} />
      <div className="trail-item__content">
        <div className="trail-item__header">
          <span className="trail-item__name">
            <span style={{ color: fromConfig.color }}>
              {fromConfig.icon} {delegation.fromAgent}
            </span>
            <span className={`trail-item__arrow ${isReturn ? 'trail-item__arrow--return' : ''}`}>
              →
            </span>
            <span style={{ color: toConfig.color }}>
              {toConfig.icon} {delegation.toAgent}
            </span>
          </span>
        </div>
        {delegation.task && (
          <div className="trail-item__task-preview" title={delegation.task}>
            {delegation.task.length > 50 ? delegation.task.slice(0, 50) + '...' : delegation.task}
          </div>
        )}
      </div>
    </div>
  );
}

export { AgentActivityChip, AgentDelegationChip };
export default AgentActivityChip;
