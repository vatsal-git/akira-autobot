import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { APPEARANCE_EMOJI, getCurrentAppearance, applyAppearance } from '../config/theme';

const APPEARANCE_OPTIONS = ['light', 'dark'];

export function SettingsModal({ open, onClose, settings: initialSettings, onSettingsChange }) {
  const [temperature, setTemperature] = useState(
    () => initialSettings?.temperature ?? 0.7
  );
  const [maxTokens, setMaxTokens] = useState(
    () => initialSettings?.max_tokens ?? 131072
  );
  const [thinkingEnabled, setThinkingEnabled] = useState(
    () => initialSettings?.thinking_enabled ?? true
  );
  const [thinkingBudget, setThinkingBudget] = useState(
    () => initialSettings?.thinking_budget ?? 16000
  );
  const [enabledTools, setEnabledTools] = useState(
    () => initialSettings?.enabled_tools ?? {}
  );
  const [stream, setStream] = useState(() => initialSettings?.stream ?? true);
  const [autonomousMode, setAutonomousMode] = useState(
    () => initialSettings?.autonomous_mode ?? false
  );
  const [appearance, setAppearance] = useState(() => getCurrentAppearance() || 'light');
  const [tooltipActive, setTooltipActive] = useState(null);
  const [tooltipRect, setTooltipRect] = useState(null);
  const tooltipAnchorRef = useRef(null);

  const tools = initialSettings?.tools ?? [];

  useLayoutEffect(() => {
    if (!tooltipActive || !tooltipAnchorRef.current) {
      setTooltipRect(null);
      return;
    }
    const el = tooltipAnchorRef.current;
    const rect = el.getBoundingClientRect();
    const centerY = rect.top + rect.height / 2;
    setTooltipRect({ left: rect.right + 8, top: centerY });
  }, [tooltipActive]);

  useEffect(() => {
    if (!open) return;
    setTemperature(initialSettings?.temperature ?? 0.7);
    setMaxTokens(initialSettings?.max_tokens ?? 131072);
    setThinkingEnabled(initialSettings?.thinking_enabled ?? true);
    setThinkingBudget(initialSettings?.thinking_budget ?? 16000);
    setEnabledTools(initialSettings?.enabled_tools ?? {});
    setStream(initialSettings?.stream ?? true);
    setAutonomousMode(initialSettings?.autonomous_mode ?? false);
    setAppearance(getCurrentAppearance() || 'light');
    setTooltipActive(null);
  }, [open, initialSettings]);

  useEffect(() => {
    if (!open) return;
    const onEscape = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onEscape);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  const handleToolToggle = (name, enabled) => {
    setEnabledTools((prev) => ({ ...prev, [name]: enabled }));
  };

  const handleSave = () => {
    onSettingsChange({
      temperature: Number(temperature),
      max_tokens: Number(maxTokens),
      thinking_enabled: thinkingEnabled,
      thinking_budget: Number(thinkingBudget),
      enabled_tools: { ...enabledTools },
      stream: Boolean(stream),
      autonomous_mode: Boolean(autonomousMode),
    });
    applyAppearance(appearance, true);
    onClose();
  };

  if (!open) return null;

  const effectiveAppearance = APPEARANCE_OPTIONS.includes(appearance) ? appearance : 'light';
  const isDarkMode = effectiveAppearance === 'dark';

  const modal = createPortal(
    <div
      className="settings-modal-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="settings-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <header className="settings-modal__header">
          <div className="settings-modal__title-block">
            <h2 id="settings-modal-title" className="settings-modal__title">
              Settings
            </h2>
          </div>
          <button
            type="button"
            className="settings-modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>
        <div className="settings-modal__body">
          <section className="settings-modal__section" aria-labelledby="settings-llm-heading">
            <h3 id="settings-llm-heading" className="settings-modal__section-title">
              LLM
            </h3>
            <div className="settings-modal__field">
              <span className="settings-modal__label">Model</span>
              <span className="settings-modal__readonly">
                {initialSettings?.current_model ?? 'Anthropic'}
              </span>
            </div>
            <div className="settings-modal__field">
              <label htmlFor="settings-temperature" className="settings-modal__label">
                Temperature
              </label>
              <input
                id="settings-temperature"
                type="number"
                min={initialSettings?.temperature_min ?? 0}
                max={initialSettings?.temperature_max ?? 2}
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                className="settings-modal__input"
                aria-describedby="settings-temperature-hint"
              />
              <span id="settings-temperature-hint" className="settings-modal__hint">
                {initialSettings?.temperature_min ?? 0}–{initialSettings?.temperature_max ?? 2}. Lower is more focused, higher more creative.
              </span>
            </div>
            <div className="settings-modal__field">
              <label htmlFor="settings-max-tokens" className="settings-modal__label">
                Max tokens
              </label>
              <input
                id="settings-max-tokens"
                type="number"
                min={initialSettings?.max_tokens_min ?? 1}
                max={initialSettings?.max_tokens_max ?? 200000}
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                className="settings-modal__input"
              />
            </div>
            <div className="settings-modal__field settings-modal__field--row">
              <input
                id="settings-thinking"
                type="checkbox"
                checked={thinkingEnabled}
                onChange={(e) => setThinkingEnabled(e.target.checked)}
                className="settings-modal__checkbox"
                aria-describedby="settings-thinking-hint"
              />
              <label htmlFor="settings-thinking" className="settings-modal__label settings-modal__label--inline">
                Enable extended thinking
              </label>
              <span id="settings-thinking-hint" className="settings-modal__hint settings-modal__hint--inline">
                Lets the model reason before replying.
              </span>
            </div>
            {thinkingEnabled && (
              <div className="settings-modal__field">
                <label htmlFor="settings-thinking-budget" className="settings-modal__label">
                  Thinking budget
                </label>
                <input
                  id="settings-thinking-budget"
                  type="number"
                  min={initialSettings?.thinking_budget_min ?? 1024}
                  max={initialSettings?.thinking_budget_max ?? 128000}
                  value={thinkingBudget}
                  onChange={(e) => setThinkingBudget(e.target.value)}
                  className="settings-modal__input"
                />
              </div>
            )}
            <div className="settings-modal__field settings-modal__field--row">
              <input
                id="settings-stream"
                type="checkbox"
                checked={stream}
                onChange={(e) => setStream(e.target.checked)}
                className="settings-modal__checkbox"
                aria-describedby="settings-stream-hint"
              />
              <label htmlFor="settings-stream" className="settings-modal__label settings-modal__label--inline">
                Stream responses
              </label>
              <span id="settings-stream-hint" className="settings-modal__hint settings-modal__hint--inline">
                Show reply as it’s generated. Off = wait for full reply.
              </span>
            </div>
            <div className="settings-modal__field settings-modal__field--row">
              <input
                id="settings-autonomous"
                type="checkbox"
                checked={autonomousMode}
                onChange={(e) => setAutonomousMode(e.target.checked)}
                className="settings-modal__checkbox"
                aria-describedby="settings-autonomous-hint"
              />
              <label htmlFor="settings-autonomous" className="settings-modal__label settings-modal__label--inline">
                Autonomous mode
              </label>
              <span id="settings-autonomous-hint" className="settings-modal__hint settings-modal__hint--inline">
                After you send a message, the model keeps replying in a loop. You can send another message anytime; it will be used after the current reply finishes.
              </span>
            </div>
          </section>

          <section className="settings-modal__section" aria-labelledby="settings-tools-heading">
            <h3 id="settings-tools-heading" className="settings-modal__section-title">
              Tools
            </h3>
            <p className="settings-modal__section-desc">
              Enable or disable tools Akira can use in chat.
            </p>
            <ul className="settings-modal__tools-list">
              {tools.map((tool) => {
                const isEnabled = enabledTools[tool.name] !== undefined
                  ? enabledTools[tool.name]
                  : tool.default_enabled !== false;
                return (
                  <li key={tool.name} className="settings-modal__tool-row">
                    <div className="settings-modal__tool-info">
                      <span className="settings-modal__tool-name">{tool.name}</span>
                    </div>
                    <div className="settings-modal__tool-actions">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isEnabled}
                        aria-label={`${tool.name} ${isEnabled ? 'on' : 'off'}`}
                        className={`settings-modal__toggle ${isEnabled ? 'settings-modal__toggle--on' : ''}`}
                        onClick={() => handleToolToggle(tool.name, !isEnabled)}
                      >
                        <span className="settings-modal__toggle-thumb" />
                      </button>
                      {tool.description && (
                        <button
                          type="button"
                          ref={(el) => {
                          if (tooltipActive?.name === tool.name) tooltipAnchorRef.current = el;
                        }}
                          className="settings-modal__tool-info-icon"
                          aria-label={`Details for ${tool.name}`}
                          aria-describedby={tooltipActive?.name === tool.name ? `settings-tooltip-${tool.name.replace(/\W+/g, '-')}` : undefined}
                          onMouseEnter={() => { setTooltipActive({ name: tool.name, description: tool.description }); }}
                          onMouseLeave={() => setTooltipActive(null)}
                          onFocus={() => { setTooltipActive({ name: tool.name, description: tool.description }); }}
                          onBlur={() => setTooltipActive(null)}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 16v-4M12 8h.01" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="settings-modal__section" aria-labelledby="settings-appearance-heading">
            <h3 id="settings-appearance-heading" className="settings-modal__section-title">
              Appearance
            </h3>
            <div className="settings-modal__field settings-modal__field--appearance">
              <span id="settings-color-scheme-label" className="settings-modal__label">
                Color scheme
              </span>
              <div
                className="settings-modal__appearance-switch-row"
                aria-labelledby="settings-color-scheme-label"
              >
                <span
                  className={`settings-modal__appearance-side ${!isDarkMode ? 'settings-modal__appearance-side--active' : ''}`}
                >
                  <span className="settings-modal__appearance-emoji" aria-hidden>
                    {APPEARANCE_EMOJI.light}
                  </span>{' '}
                  Light
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isDarkMode}
                  aria-labelledby="settings-color-scheme-label"
                  className={`settings-modal__toggle ${isDarkMode ? 'settings-modal__toggle--on' : ''}`}
                  onClick={() =>
                    setAppearance((prev) => {
                      const cur = APPEARANCE_OPTIONS.includes(prev) ? prev : 'light';
                      return cur === 'dark' ? 'light' : 'dark';
                    })
                  }
                >
                  <span className="settings-modal__toggle-thumb" />
                </button>
                <span
                  className={`settings-modal__appearance-side ${isDarkMode ? 'settings-modal__appearance-side--active' : ''}`}
                >
                  <span className="settings-modal__appearance-emoji" aria-hidden>
                    {APPEARANCE_EMOJI.dark}
                  </span>{' '}
                  Dark
                </span>
              </div>
            </div>
          </section>
        </div>
        <footer className="settings-modal__footer">
          <button
            type="button"
            className="settings-modal__btn settings-modal__btn--secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="settings-modal__btn settings-modal__btn--primary"
            onClick={handleSave}
          >
            Save
          </button>
        </footer>
      </div>
    </div>,
    document.body
  );

  const tooltipPortal =
    tooltipActive && tooltipRect
      ? createPortal(
          <div
            id={tooltipActive.name ? `settings-tooltip-${tooltipActive.name.replace(/\W+/g, '-')}` : undefined}
            className="settings-modal__tool-tooltip settings-modal__tool-tooltip--portal"
            role="tooltip"
            style={{
              position: 'fixed',
              left: tooltipRect.left,
              top: tooltipRect.top,
              transform: 'translateY(-50%)',
              zIndex: 1001,
            }}
          >
            {tooltipActive.description}
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {modal}
      {tooltipPortal}
    </>
  );
}
