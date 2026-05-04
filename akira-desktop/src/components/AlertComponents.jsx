import React, { useState } from 'react';
import '../styles/alerts.css';

/**
 * Emergency Stop Alert - Inline alert shown when an agent triggers emergency stop
 */
export function EmergencyStopAlert({ alert, onResponse }) {
  const [selectedAction, setSelectedAction] = useState(null);
  const [customInput, setCustomInput] = useState('');

  const severityIcons = {
    warning: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
    error: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
      </svg>
    ),
    critical: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    )
  };

  const handleSubmit = () => {
    if (selectedAction) {
      onResponse({
        action: selectedAction,
        notes: customInput || undefined
      });
    }
  };

  return (
    <div className={`alert alert--emergency alert--${alert.severity}`}>
      <div className="alert__header">
        <div className="alert__icon">
          {severityIcons[alert.severity] || severityIcons.warning}
        </div>
        <div className="alert__title">
          {alert.severity === 'critical' ? 'CRITICAL' :
           alert.severity === 'error' ? 'ERROR' : 'WARNING'} - {alert.triggeredBy || 'Agent'} paused
        </div>
      </div>

      <div className="alert__body">
        <div className="alert__reason">{alert.reason}</div>
        {alert.context && (
          <div className="alert__context">
            <span className="alert__context-label">Context:</span> {alert.context}
          </div>
        )}
      </div>

      {alert.requiresResponse && (
        <div className="alert__actions">
          {(alert.suggestedActions || ['Continue', 'Abort']).map((action) => (
            <button
              key={action}
              className={`alert__action-btn ${selectedAction === action ? 'alert__action-btn--selected' : ''}`}
              onClick={() => setSelectedAction(action)}
            >
              {action}
            </button>
          ))}
        </div>
      )}

      {alert.requiresResponse && selectedAction && (
        <div className="alert__submit-area">
          <button
            className="alert__submit-btn"
            onClick={handleSubmit}
          >
            Confirm: {selectedAction}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Clarification Request - Inline prompt when an agent needs clarification
 */
export function ClarificationRequest({ request, onResponse }) {
  const [selectedOption, setSelectedOption] = useState(null);
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const handleSubmit = () => {
    const response = showCustom
      ? customInput
      : selectedOption?.label || selectedOption;

    if (response) {
      onResponse({
        response,
        selectedOption: showCustom ? null : selectedOption
      });
    }
  };

  const handleSkip = () => {
    if (request.canSkip && request.defaultAction) {
      onResponse({
        response: request.defaultAction,
        source: 'skip_default'
      });
    }
  };

  return (
    <div className="alert alert--clarification">
      <div className="alert__header">
        <div className="alert__icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div className="alert__title">
          {request.fromAgent || 'Agent'} needs clarification
        </div>
      </div>

      <div className="alert__body">
        <div className="alert__question">{request.question}</div>
        {request.whatIUnderstood && (
          <div className="alert__context">
            <span className="alert__context-label">I understood:</span> {request.whatIUnderstood}
          </div>
        )}
      </div>

      {request.options && request.options.length > 0 && !showCustom && (
        <div className="alert__options">
          {request.options.map((option, idx) => (
            <button
              key={idx}
              className={`alert__option-btn ${selectedOption === option ? 'alert__option-btn--selected' : ''}`}
              onClick={() => setSelectedOption(option)}
            >
              <span className="alert__option-label">{option.label || option}</span>
              {option.description && (
                <span className="alert__option-desc">{option.description}</span>
              )}
            </button>
          ))}
          <button
            className="alert__option-btn alert__option-btn--custom"
            onClick={() => setShowCustom(true)}
          >
            <span className="alert__option-label">Other...</span>
          </button>
        </div>
      )}

      {showCustom && (
        <div className="alert__custom-input">
          <input
            type="text"
            className="alert__input"
            placeholder="Type your answer..."
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customInput.trim()) {
                handleSubmit();
              }
            }}
            autoFocus
          />
          {request.options && request.options.length > 0 && (
            <button
              className="alert__back-btn"
              onClick={() => setShowCustom(false)}
            >
              Back to options
            </button>
          )}
        </div>
      )}

      <div className="alert__submit-area">
        <button
          className="alert__submit-btn"
          onClick={handleSubmit}
          disabled={!selectedOption && !customInput.trim()}
        >
          Submit
        </button>
        {request.canSkip && request.defaultAction && (
          <button
            className="alert__skip-btn"
            onClick={handleSkip}
          >
            Skip (use: {request.defaultAction})
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Internal Task Indicator - Shows when a task is running with internal visibility
 */
export function InternalTaskIndicator({ task }) {
  return (
    <div className="internal-indicator">
      <div className="internal-indicator__dot" />
      <span className="internal-indicator__text">
        {task.agent || 'Agent'} working...
      </span>
    </div>
  );
}
