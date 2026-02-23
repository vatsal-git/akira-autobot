import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { THEME_LABELS, THEME_EMOJI, getCurrentThemeName, applyTheme } from '../config/theme';

const THEME_OPTIONS = Object.keys(THEME_LABELS).filter(
  (key) => !['excited', 'default_light', 'default_dark', 'energetic', 'focus', 'cozy', 'midnight'].includes(key)
);

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
  const [theme, setTheme] = useState(() => getCurrentThemeName() || 'neutral');
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const appearanceRef = useRef(null);

  const tools = initialSettings?.tools ?? [];

  useEffect(() => {
    if (!open) return;
    setTemperature(initialSettings?.temperature ?? 0.7);
    setMaxTokens(initialSettings?.max_tokens ?? 131072);
    setThinkingEnabled(initialSettings?.thinking_enabled ?? true);
    setThinkingBudget(initialSettings?.thinking_budget ?? 16000);
    setEnabledTools(initialSettings?.enabled_tools ?? {});
    setTheme(getCurrentThemeName() || 'neutral');
    setAppearanceOpen(false);
  }, [open, initialSettings]);

  useEffect(() => {
    if (!appearanceOpen) return;
    const handleClickOutside = (e) => {
      if (appearanceRef.current && !appearanceRef.current.contains(e.target)) {
        setAppearanceOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [appearanceOpen]);

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
    });
    applyTheme(theme, true);
    onClose();
  };

  if (!open) return null;

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
          <h2 id="settings-modal-title" className="settings-modal__title">
            Settings
          </h2>
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
                min="0"
                max="2"
                step="0.1"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                className="settings-modal__input"
                aria-describedby="settings-temperature-hint"
              />
              <span id="settings-temperature-hint" className="settings-modal__hint">
                0–2. Lower is more focused, higher more creative.
              </span>
            </div>
            <div className="settings-modal__field">
              <label htmlFor="settings-max-tokens" className="settings-modal__label">
                Max tokens
              </label>
              <input
                id="settings-max-tokens"
                type="number"
                min="1"
                max="200000"
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
                  min="1024"
                  max="100000"
                  value={thinkingBudget}
                  onChange={(e) => setThinkingBudget(e.target.value)}
                  className="settings-modal__input"
                />
              </div>
            )}
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
                      {tool.description && (
                        <span className="settings-modal__tool-desc">{tool.description}</span>
                      )}
                    </div>
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
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="settings-modal__section" aria-labelledby="settings-theme-heading">
            <h3 id="settings-theme-heading" className="settings-modal__section-title">
              Theme
            </h3>
            <div className="settings-modal__field" ref={appearanceRef}>
              <label id="settings-appearance-label" className="settings-modal__label">
                Appearance
              </label>
              <div className="settings-modal__appearance">
                <button
                  type="button"
                  className="settings-modal__appearance-trigger"
                  onClick={() => setAppearanceOpen((o) => !o)}
                  aria-haspopup="listbox"
                  aria-expanded={appearanceOpen}
                  aria-labelledby="settings-appearance-label"
                  aria-describedby="settings-appearance-value"
                >
                  <span className="settings-modal__appearance-emoji" aria-hidden>
                    {THEME_EMOJI[theme] ?? THEME_EMOJI.neutral ?? '✨'}
                  </span>
                  <span id="settings-appearance-value" className="settings-modal__appearance-label">
                    {THEME_LABELS[theme] ?? THEME_LABELS.neutral ?? 'Neutral'}
                  </span>
                  <svg className="settings-modal__appearance-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {appearanceOpen && (
                  <ul
                    className="settings-modal__appearance-list"
                    role="listbox"
                    aria-labelledby="settings-appearance-label"
                    tabIndex={-1}
                  >
                    {THEME_OPTIONS.map((key) => {
                      const isSelected = (THEME_OPTIONS.includes(theme || '') ? theme : 'neutral') === key;
                      return (
                        <li key={key} role="option" aria-selected={isSelected}>
                          <button
                            type="button"
                            className={`settings-modal__appearance-option ${isSelected ? 'settings-modal__appearance-option--selected' : ''}`}
                            onClick={() => {
                              setTheme(key);
                              setAppearanceOpen(false);
                            }}
                          >
                            <span className="settings-modal__appearance-emoji" aria-hidden>
                              {THEME_EMOJI[key] ?? '✨'}
                            </span>
                            <span className="settings-modal__appearance-option-label">
                              {THEME_LABELS[key] ?? key}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
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

  return modal;
}
