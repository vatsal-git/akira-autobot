import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import '../styles/settings.css';

function SettingsPanel({ settings, onClose, onSettingsChange, inline = false }) {
  const [localSettings, setLocalSettings] = useState(settings || {});
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    loadModels();
  }, []);

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

  const handleSave = async () => {
    setSaving(true);
    try {
      // Check if widget mode changed
      const modeChanged = localSettings.widgetMode !== settings?.widgetMode;

      await window.akira.saveSettings(localSettings);

      // If widget mode changed, apply it (this will recreate the window)
      if (modeChanged && window.akira?.setWidgetMode) {
        await window.akira.setWidgetMode(localSettings.widgetMode || 'compact');
      } else {
        onSettingsChange();
        onClose();
      }
    } catch (error) {
      console.error('Error saving settings:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleApiKeyChange = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    try {
      await window.akira.setApiKey(apiKey.trim());
      await loadModels();
    } catch (error) {
      console.error('Error updating API key:', error);
    } finally {
      setLoading(false);
    }
  };

  const content = (
    <>
      <div className="settings-panel__content">
          {/* API Key */}
          <div className="settings-panel__section">
            <h3 className="settings-panel__section-title">API Key</h3>
            <div className="settings-panel__input-group">
              <input
                type={showApiKey ? 'text' : 'password'}
                className="settings-panel__input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-..."
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
              <button
                className="settings-panel__btn-small"
                onClick={handleApiKeyChange}
                disabled={loading}
              >
                {loading ? 'Saving...' : 'Update'}
              </button>
            </div>
          </div>

          {/* Model Selection */}
          <div className="settings-panel__section">
            <h3 className="settings-panel__section-title">Model</h3>
            <select
              className="settings-panel__select"
              value={localSettings.defaultModel || ''}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, defaultModel: e.target.value })
              }
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name || model.id}
                </option>
              ))}
            </select>
          </div>

          {/* Temperature */}
          <div className="settings-panel__section">
            <h3 className="settings-panel__section-title">Temperature</h3>
            <select
              className="settings-panel__select"
              value={localSettings.temperature || 0.7}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, temperature: parseFloat(e.target.value) })
              }
            >
              <option value="0.3">Grounded</option>
              <option value="0.7">Neutral</option>
              <option value="1.3">Creative</option>
            </select>
          </div>

          {/* Theme */}
          <div className="settings-panel__section">
            <h3 className="settings-panel__section-title">Theme</h3>
            <select
              className="settings-panel__select"
              value={localSettings.theme || 'system'}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, theme: e.target.value })
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          {/* Widget Mode */}
          <div className="settings-panel__section">
            <h3 className="settings-panel__section-title">Widget Mode</h3>
            <div className="settings-panel__mode-grid settings-panel__mode-grid--3">
              <button
                className={`settings-panel__mode-btn ${(localSettings.widgetMode || 'compact') === 'compact' ? 'settings-panel__mode-btn--active' : ''}`}
                onClick={() => setLocalSettings({ ...localSettings, widgetMode: 'compact' })}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="6" y="4" width="12" height="16" rx="2" />
                </svg>
                <span>Compact</span>
              </button>
              <button
                className={`settings-panel__mode-btn ${localSettings.widgetMode === 'sidebar' ? 'settings-panel__mode-btn--active' : ''}`}
                onClick={() => setLocalSettings({ ...localSettings, widgetMode: 'sidebar' })}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="14" y="2" width="8" height="20" rx="1" />
                  <path d="M4 6h6M4 10h6M4 14h4" strokeOpacity="0.4" />
                </svg>
                <span>Sidebar</span>
              </button>
              <button
                className={`settings-panel__mode-btn ${localSettings.widgetMode === 'window' ? 'settings-panel__mode-btn--active' : ''}`}
                onClick={() => setLocalSettings({ ...localSettings, widgetMode: 'window' })}
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

        </div>

      <div className="settings-panel__footer">
        <button className="settings-panel__btn settings-panel__btn--secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="settings-panel__btn settings-panel__btn--primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </>
  );

  // Inline mode: render content directly without overlay
  if (inline) {
    return (
      <motion.div
        className="settings-panel settings-panel--inline"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        {content}
      </motion.div>
    );
  }

  // Overlay mode (default)
  return (
    <motion.div
      className="settings-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="settings-panel"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-panel__header">
          <h2 className="settings-panel__title">Settings</h2>
          <button className="settings-panel__close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        {content}
      </motion.div>
    </motion.div>
  );
}

export default SettingsPanel;
