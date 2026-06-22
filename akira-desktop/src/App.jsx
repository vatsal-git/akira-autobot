import React, { useState, useEffect } from 'react';
import Widget from './components/Widget';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/app.css';

function App() {
  const [isConfigured, setIsConfigured] = useState(null); // null = loading
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    checkConfiguration();
    loadSettings();

    // Listen for settings open event from tray
    let cleanup = null;
    if (window.akira?.onOpenSettings) {
      cleanup = window.akira.onOpenSettings(() => {
        window.dispatchEvent(new CustomEvent('akira-open-settings'));
      });
    }

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const checkConfiguration = async () => {
    try {
      if (window.akira?.getSelectedProvider && window.akira?.getProviderApiKey) {
        // Check if the selected provider has an API key configured
        const selectedProvider = await window.akira.getSelectedProvider();
        const apiKey = await window.akira.getProviderApiKey(selectedProvider);
        setIsConfigured(!!apiKey);
      } else if (window.akira?.hasApiKey) {
        // Fallback to legacy check
        const hasKey = await window.akira.hasApiKey();
        setIsConfigured(hasKey);
      } else {
        // Browser testing mode - show setup
        setIsConfigured(false);
      }
    } catch (error) {
      console.error('Error checking configuration:', error);
      setIsConfigured(false);
    }
  };

  const loadSettings = async () => {
    try {
      if (window.akira?.getSettings) {
        const appSettings = await window.akira.getSettings();
        setSettings(appSettings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  };

  const handleSetupComplete = () => {
    setIsConfigured(true);
    loadSettings();
  };

  // Show loading state while checking configuration
  if (isConfigured === null) {
    return (
      <div className="app-loading">
        <div className="app-loading__spinner" />
      </div>
    );
  }

  // Show Widget for both setup mode and normal mode
  return (
    <ErrorBoundary>
      <Widget
        settings={settings}
        onSettingsChange={loadSettings}
        isSetupMode={!isConfigured}
        onSetupComplete={handleSetupComplete}
      />
    </ErrorBoundary>
  );
}

export default App;
