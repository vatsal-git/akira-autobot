import React, { useState, useEffect, useRef } from 'react';
import { AnimatePresence } from 'framer-motion';
import '../styles/settings.css';

function Dropdown({ value, options, groups, onChange, placeholder = 'Select...' }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const allOptions = groups
    ? groups.flatMap(g => g.options)
    : options;
  const selectedOption = allOptions?.find(opt => opt.value === value);
  const displayValue = selectedOption?.label || placeholder;

  return (
    <div
      ref={dropdownRef}
      className={`settings-panel__dropdown ${isOpen ? 'settings-panel__dropdown--open' : ''}`}
    >
      <button
        type="button"
        className="settings-panel__dropdown-trigger"
        onClick={() => setIsOpen(!isOpen)}
      >
        {displayValue}
      </button>
      <AnimatePresence>
        {isOpen && (
          <div className="settings-panel__dropdown-menu">
            {groups ? (
              groups.map((group, idx) => (
                <div key={idx}>
                  {group.label && (
                    <div className="settings-panel__dropdown-group-label">{group.label}</div>
                  )}
                  {group.options.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`settings-panel__dropdown-item ${value === opt.value ? 'settings-panel__dropdown-item--selected' : ''}`}
                      onClick={() => {
                        onChange(opt.value);
                        setIsOpen(false);
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ))
            ) : (
              options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`settings-panel__dropdown-item ${value === opt.value ? 'settings-panel__dropdown-item--selected' : ''}`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ))
            )}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SettingsPanel({ settings, onClose, onSettingsChange, inline = false, currentView: externalView, onViewChange }) {
  const [localSettings, setLocalSettings] = useState(settings || {});
  const [initialScreenCaptureValue] = useState(settings?.hideFromScreenshots ?? false);
  const [models, setModels] = useState([]);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [internalView, setInternalView] = useState('general'); // 'general', 'model', or 'agents'
  const [agentPrompts, setAgentPrompts] = useState([]);
  const [expandedAgent, setExpandedAgent] = useState(null);
  const debounceTimers = useRef({});

  // Provider state
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState('openrouter');
  const [providerApiKeys, setProviderApiKeys] = useState({});
  const [selectedModel, setSelectedModel] = useState('');

  // Token settings (local state for editing, per-model)
  const [maxTokensInput, setMaxTokensInput] = useState('16384');
  const [thinkingBudgetInput, setThinkingBudgetInput] = useState('10000');

  // Use external view if provided (inline mode), otherwise use internal state
  const currentView = externalView !== undefined ? externalView : internalView;
  const setCurrentView = onViewChange || setInternalView;

  useEffect(() => {
    loadModels();
    loadProviders();
  }, []);

  useEffect(() => {
    if (currentView === 'agents') {
      loadAgentPrompts();
    }
  }, [currentView]);

  useEffect(() => {
    return () => {
      // Clean up timers on unmount
      Object.values(debounceTimers.current).forEach(clearTimeout);
    };
  }, []);

  const loadAgentPrompts = async () => {
    try {
      const prompts = await window.akira.getAgentPrompts();
      setAgentPrompts(prompts || []);
    } catch (error) {
      console.error('Error loading agent prompts:', error);
    }
  };

  const handlePromptChange = (agentName, newText) => {
    // Update local state immediately for responsive typing
    setAgentPrompts(prev => prev.map(agent => {
      if (agent.name === agentName) {
        return { ...agent, systemPrompt: newText };
      }
      return agent;
    }));

    // Debounce backend save
    if (debounceTimers.current[agentName]) {
      clearTimeout(debounceTimers.current[agentName]);
    }

    debounceTimers.current[agentName] = setTimeout(async () => {
      try {
        await window.akira.updateAgentPrompt(agentName, newText);
      } catch (error) {
        console.error(`Error saving agent prompt for ${agentName}:`, error);
      }
    }, 800);
  };

  const handleResetPrompt = async (agentName) => {
    if (debounceTimers.current[agentName]) {
      clearTimeout(debounceTimers.current[agentName]);
    }

    const confirmed = window.confirm(`Are you sure you want to reset the system prompt for ${agentName} to default?`);
    if (!confirmed) return;

    try {
      const defaultPrompt = await window.akira.resetAgentPrompt(agentName);
      setAgentPrompts(prev => prev.map(agent => {
        if (agent.name === agentName) {
          return { ...agent, systemPrompt: defaultPrompt };
        }
        return agent;
      }));
    } catch (error) {
      console.error(`Error resetting agent prompt for ${agentName}:`, error);
    }
  };

  const handleThinkingLevelChange = async (agentName, level) => {
    // Update local state immediately
    setAgentPrompts(prev => prev.map(agent => {
      if (agent.name === agentName) {
        return { ...agent, thinkingLevel: level };
      }
      return agent;
    }));

    // Save to backend
    try {
      await window.akira.setAgentThinkingLevel(agentName, level);
    } catch (error) {
      console.error(`Error setting thinking level for ${agentName}:`, error);
    }
  };

  const toggleAgentExpanded = (agentName) => {
    setExpandedAgent(prev => prev === agentName ? null : agentName);
  };

  // Sync settings prop to localSettings when it changes
  useEffect(() => {
    if (settings) {
      setLocalSettings(settings);

    }
  }, [settings]);

  const loadModels = async () => {
    try {
      const key = await window.akira.getApiKey();
      if (key) {
        setApiKey(key);
      }
      // Load free models (no API key required)
      const modelList = await window.akira.getModels();
      setModels(modelList);
    } catch (error) {
      console.error('Error loading models:', error);
    }
  };

  // Load provider settings
  const loadProviders = async () => {
    try {
      const providerList = await window.akira.getProviders();
      setProviders(providerList);

      const currentProvider = await window.akira.getSelectedProvider();
      setSelectedProvider(currentProvider);

      const currentModel = await window.akira.getSelectedModel();
      setSelectedModel(currentModel);

      // Load model-specific settings
      const modelSettings = await window.akira.getModelSettings(currentModel);
      setMaxTokensInput(String(modelSettings.maxTokens || 16384));
      setThinkingBudgetInput(String(modelSettings.thinkingBudget || 10000));

      // Load API keys for all providers
      const keys = {};
      for (const provider of providerList) {
        const key = await window.akira.getProviderApiKey(provider.id);
        keys[provider.id] = key || '';
      }
      setProviderApiKeys(keys);
    } catch (error) {
      console.error('Error loading providers:', error);
    }
  };

  // Handle provider change
  const handleProviderChange = async (providerId) => {
    setSelectedProvider(providerId);
    await window.akira.setSelectedProvider(providerId);

    // Set default model for this provider if current model doesn't match
    const provider = providers.find(p => p.id === providerId);
    if (provider) {
      setSelectedModel(provider.defaultModel);
      await window.akira.setSelectedModel(provider.defaultModel);
    }

    onSettingsChange();
  };

  // Handle provider API key change
  const handleProviderApiKeyChange = (providerId, value) => {
    setProviderApiKeys(prev => ({ ...prev, [providerId]: value }));
  };

  // Save provider API key on blur
  const handleProviderApiKeyBlur = async (providerId) => {
    const key = providerApiKeys[providerId]?.trim() || '';
    await window.akira.setProviderApiKey(providerId, key);
    onSettingsChange();
  };

  // Handle model change
  const handleModelChange = async (model) => {
    setSelectedModel(model);
    await window.akira.setSelectedModel(model);
    // Load model-specific settings for the new model
    const modelSettings = await window.akira.getModelSettings(model);
    setMaxTokensInput(String(modelSettings.maxTokens || 16384));
    setThinkingBudgetInput(String(modelSettings.thinkingBudget || 10000));
    onSettingsChange();
  };

  // Save setting immediately when changed
  const updateSetting = async (key, value) => {
    const newSettings = { ...localSettings, [key]: value };
    setLocalSettings(newSettings);

    try {
      await window.akira.saveSettings({ [key]: value });

      // If widget mode changed, apply it
      if (key === 'widgetMode' && window.akira?.setWidgetMode) {
        await window.akira.setWidgetMode(value);
      }

      onSettingsChange();
    } catch (error) {
      console.error('Error saving setting:', error);
    }
  };

  // Save API key on blur
  const handleApiKeyBlur = async () => {
    if (apiKey.trim()) {
      try {
        await window.akira.setApiKey(apiKey.trim());
      } catch (error) {
        console.error('Error saving API key:', error);
      }
    }
  };

  // Reset Akira with confirmation
  const handleReset = async () => {
    const confirmed = window.confirm(
      'Are you sure you want to reset Akira?\n\n' +
      'This will delete all your chats and reset settings to defaults.\n' +
      'Your API key will be preserved.'
    );

    if (confirmed) {
      try {
        await window.akira.resetAkira();
      } catch (error) {
        console.error('Error resetting Akira:', error);
      }
    }
  };

  const generalSettingsContent = (
    <div className="settings-panel__content">
      {/* Theme Setting */}
      <div className="settings-panel__section">
        <h3 className="settings-panel__section-title">Theme</h3>
        <Dropdown
          value={localSettings.theme || 'system'}
          onChange={(val) => updateSetting('theme', val)}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </div>

      {/* Model & Agents Settings - two in a row */}
      <div className="settings-panel__row settings-panel__row--2">
        <div className="settings-panel__section">
          <h3 className="settings-panel__section-title">Model Settings</h3>
          <button
            type="button"
            className="settings-panel__nav-btn settings-panel__nav-btn--compact"
            onClick={() => setCurrentView('model')}
          >
            <span>Configure</span>
            <svg className="settings-panel__nav-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>

        <div className="settings-panel__section">
          <h3 className="settings-panel__section-title">Agents Settings</h3>
          <button
            type="button"
            className="settings-panel__nav-btn settings-panel__nav-btn--compact"
            onClick={() => setCurrentView('agents')}
          >
            <span>Configure</span>
            <svg className="settings-panel__nav-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </button>
        </div>
      </div>

      {/* Widget Mode */}
      <div className="settings-panel__section">
        <h3 className="settings-panel__section-title">Widget Mode</h3>
        <div className="settings-panel__mode-grid settings-panel__mode-grid--3">
          <button
            className={`settings-panel__mode-btn ${(localSettings.widgetMode || 'compact') === 'compact' ? 'settings-panel__mode-btn--active' : ''}`}
            onClick={() => updateSetting('widgetMode', 'compact')}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="6" y="4" width="12" height="16" rx="2" />
            </svg>
            <span>Compact</span>
          </button>
          <button
            className={`settings-panel__mode-btn ${localSettings.widgetMode === 'sidebar' ? 'settings-panel__mode-btn--active' : ''}`}
            onClick={() => updateSetting('widgetMode', 'sidebar')}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="14" y="2" width="8" height="20" rx="1" />
              <path d="M4 6h6M4 10h6M4 14h4" strokeOpacity="0.4" />
            </svg>
            <span>Sidebar</span>
          </button>
          <button
            className={`settings-panel__mode-btn ${localSettings.widgetMode === 'window' ? 'settings-panel__mode-btn--active' : ''}`}
            onClick={() => updateSetting('widgetMode', 'window')}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 8h18" />
              <circle cx="6" cy="5.5" r="1" fill="currentColor" />
              <circle cx="9" cy="5.5" r="1" fill="currentColor" />
            </svg>
            <span>Window</span>
          </button>
        </div>
        <p className="settings-panel__hint">
          {localSettings.widgetMode === 'window' ? 'Opens as a normal application window' :
           localSettings.widgetMode === 'sidebar' ? 'Docks to the right side of your screen' :
           'Small floating widget (always on top)'}
        </p>
      </div>



      {/* Hide Desktop Overlay Toggle */}
      <div className="settings-panel__section">
        <div className="settings-panel__toggle-row">
          <div className="settings-panel__toggle-info">
            <h3 className="settings-panel__section-title">Hide Desktop Overlay</h3>
            <p className="settings-panel__hint settings-panel__hint--inline">Hide visual feedback during automation</p>
          </div>
          <button
            className={`settings-panel__toggle ${localSettings.hideDesktopOverlay ? 'settings-panel__toggle--active' : ''}`}
            onClick={() => updateSetting('hideDesktopOverlay', !localSettings.hideDesktopOverlay)}
            role="switch"
            aria-checked={localSettings.hideDesktopOverlay}
          >
            <span className="settings-panel__toggle-slider" />
          </button>
        </div>
      </div>

      {/* Block Screen Capture Toggle */}
      <div className="settings-panel__section">
        <div className="settings-panel__toggle-row">
          <div className="settings-panel__toggle-info">
            <h3 className="settings-panel__section-title">
              Block Screen Capture
              <span className="settings-panel__info-icon" title="Prevents this window from appearing in screenshots and screen recordings. On Windows 10 (2004+), the window is completely excluded. On older Windows, a black rectangle appears instead. On macOS, newer apps using ScreenCaptureKit may bypass this.">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
              </span>
            </h3>
            <p className="settings-panel__hint settings-panel__hint--inline">Hide window from screenshots and recordings</p>
            {localSettings.hideFromScreenshots !== initialScreenCaptureValue && (
              <p className="settings-panel__hint settings-panel__hint--warning">Restart required to apply</p>
            )}
          </div>
          <button
            className={`settings-panel__toggle ${localSettings.hideFromScreenshots ? 'settings-panel__toggle--active' : ''}`}
            onClick={() => updateSetting('hideFromScreenshots', !localSettings.hideFromScreenshots)}
            role="switch"
            aria-checked={localSettings.hideFromScreenshots}
          >
            <span className="settings-panel__toggle-slider" />
          </button>
        </div>
      </div>

      {/* Start on Startup Toggle */}
      <div className="settings-panel__section">
        <div className="settings-panel__toggle-row">
          <div className="settings-panel__toggle-info">
            <h3 className="settings-panel__section-title">Start on Startup</h3>
            <p className="settings-panel__hint settings-panel__hint--inline">Launch Akira automatically when your system starts</p>
          </div>
          <button
            className={`settings-panel__toggle ${(localSettings.openAtLogin ?? true) ? 'settings-panel__toggle--active' : ''}`}
            onClick={() => updateSetting('openAtLogin', !(localSettings.openAtLogin ?? true))}
            role="switch"
            aria-checked={localSettings.openAtLogin ?? true}
          >
            <span className="settings-panel__toggle-slider" />
          </button>
        </div>
      </div>

      {/* Reset */}
      <div className="settings-panel__section">
        <button
          className="settings-panel__btn settings-panel__btn--danger"
          onClick={handleReset}
        >
          Reset Akira
        </button>
      </div>
    </div>
  );

  // Get current provider info
  const currentProvider = providers.find(p => p.id === selectedProvider) || {};

  const modelSettingsContent = (
    <div className="settings-panel__content">
      {/* Provider Selection */}
      <div className="settings-panel__section">
        <h3 className="settings-panel__section-title">Provider</h3>
        <Dropdown
          value={selectedProvider}
          onChange={handleProviderChange}
          options={providers.map(p => ({
            value: p.id,
            label: p.name
          }))}
          placeholder="Select provider..."
        />
      </div>

      {/* API Key for Selected Provider */}
      <div className="settings-panel__section">
          <div className="settings-panel__section-header">
            <h3 className="settings-panel__section-title">{currentProvider.name || 'Provider'} API Key</h3>
            {currentProvider.docsUrl && (
              <button
                type="button"
                onClick={() => window.akira?.openExternal?.(currentProvider.docsUrl)}
                className="settings-panel__tutorial-link"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Get Key
              </button>
            )}
          </div>
          <div className="settings-panel__input-group">
            <input
              type={showApiKey ? 'text' : 'password'}
              className="settings-panel__input"
              value={providerApiKeys[selectedProvider] || ''}
              onChange={(e) => handleProviderApiKeyChange(selectedProvider, e.target.value)}
              onBlur={() => handleProviderApiKeyBlur(selectedProvider)}
              placeholder={currentProvider.apiKeyPlaceholder || 'Enter API key...'}
            />
            <button
              className="settings-panel__btn-icon"
              onClick={() => setShowApiKey(!showApiKey)}
              title={showApiKey ? 'Hide' : 'Show'}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {showApiKey ? (
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24M1 1l22 22" />
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          </div>
        </div>

      {/* Model Input */}
      <div className="settings-panel__section">
        <h3 className="settings-panel__section-title">Model</h3>
        <input
          type="text"
          className="settings-panel__input"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          onBlur={() => handleModelChange(selectedModel)}
          placeholder={currentProvider.defaultModel || 'Enter model name...'}
        />
        <p className="settings-panel__hint">
          Enter the model ID (e.g., {currentProvider.defaultModel || 'model-name'})
        </p>
      </div>

      {/* Creativity */}
      <div className="settings-panel__section">
        <h3 className="settings-panel__section-title">Creativity</h3>
        <Dropdown
          value={localSettings.temperature || 0.7}
          onChange={(val) => updateSetting('temperature', parseFloat(val))}
          options={[
            { value: 0.3, label: 'Low' },
            { value: 0.7, label: 'Medium' },
            { value: 1.3, label: 'High' },
          ]}
        />
      </div>

      {/* Max Tokens & Thinking Budget */}
      <div className="settings-panel__row settings-panel__row--2">
        <div className="settings-panel__section">
          <h3 className="settings-panel__section-title">Max Tokens</h3>
          <input
            type="number"
            className="settings-panel__input"
            value={maxTokensInput}
            onChange={(e) => setMaxTokensInput(e.target.value)}
            onBlur={async () => {
              await window.akira.setModelSettings(selectedModel, { maxTokens: parseInt(maxTokensInput) || 16384 });
              onSettingsChange();
            }}
            min="1000"
            max="128000"
            step="1000"
          />
        </div>

        <div className="settings-panel__section">
          <h3 className="settings-panel__section-title">Thinking Budget</h3>
          <input
            type="number"
            className="settings-panel__input"
            value={thinkingBudgetInput}
            onChange={(e) => setThinkingBudgetInput(e.target.value)}
            onBlur={async () => {
              await window.akira.setModelSettings(selectedModel, { thinkingBudget: parseInt(thinkingBudgetInput) || 10000 });
              onSettingsChange();
            }}
            min="1000"
            max="100000"
            step="1000"
          />
        </div>
        <p className="settings-panel__hint">
          Max tokens must be greater than thinking budget.
        </p>
      </div>
    </div>
  );

  const agentSettingsContent = (
    <div className="settings-panel__content">
      <div className="settings-panel__agents-list">
        {agentPrompts.map((agent) => (
          <div
            key={agent.name}
            className={`settings-panel__agent-item ${expandedAgent === agent.name ? 'settings-panel__agent-item--expanded' : ''}`}
          >
            <button
              type="button"
              className="settings-panel__agent-header"
              onClick={() => toggleAgentExpanded(agent.name)}
            >
              <div className="settings-panel__agent-info-left">
                <span className="settings-panel__agent-name">{agent.displayName}</span>
                <span className="settings-panel__agent-desc">{agent.description}</span>
              </div>
              <svg
                className="settings-panel__agent-chevron"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            
            {expandedAgent === agent.name && (
              <div className="settings-panel__agent-body">
                <div className="settings-panel__agent-setting-row">
                  <label className="settings-panel__section-title">Thinking Level</label>
                  <select
                    className="settings-panel__select"
                    value={agent.thinkingLevel || 'normal'}
                    onChange={(e) => handleThinkingLevelChange(agent.name, e.target.value)}
                  >
                    <option value="quick">Quick - Minimal reasoning</option>
                    <option value="normal">Normal - Balanced</option>
                    <option value="deep">Deep - Thorough analysis</option>
                  </select>
                </div>
                <div className="settings-panel__agent-body-header">
                  <span className="settings-panel__section-title">System Prompt</span>
                  <button
                    type="button"
                    className="settings-panel__agent-reset-btn"
                    onClick={() => handleResetPrompt(agent.name)}
                  >
                    Reset to Default
                  </button>
                </div>
                <textarea
                  className="settings-panel__agent-textarea"
                  value={agent.systemPrompt || ''}
                  onChange={(e) => handlePromptChange(agent.name, e.target.value)}
                  placeholder="Enter system prompt here..."
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  let content;
  if (currentView === 'model') {
    content = modelSettingsContent;
  } else if (currentView === 'agents') {
    content = agentSettingsContent;
  } else {
    content = generalSettingsContent;
  }

  // Inline mode: render content directly without overlay
  if (inline) {
    return (
      <div className="settings-panel settings-panel--inline">
        {content}
      </div>
    );
  }

  // Overlay mode (default)
  return (
    <div
      className="settings-overlay"
      onClick={onClose}
    >
      <div
        className="settings-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-panel__header">
          {currentView === 'model' || currentView === 'agents' ? (
            <button type="button" className="settings-panel__header-back" onClick={() => setCurrentView('general')}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          ) : null}
          <h2 className="settings-panel__title">
            {currentView === 'model' ? 'Model Settings' :
             currentView === 'agents' ? 'Agents Settings' : 'Settings'}
          </h2>
          <button type="button" className="settings-panel__close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {content}
      </div>
    </div>
  );
}

export default SettingsPanel;
