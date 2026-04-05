import React, { useState, useEffect } from 'react';
import Widget from './components/Widget';
import SetupWizard from './components/SetupWizard';
import './styles/app.css';

function App() {
  const [isConfigured, setIsConfigured] = useState(null); // null = loading
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    // Check if API key is configured
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
      if (window.akira?.hasApiKey) {
        const hasKey = await window.akira.hasApiKey();
        setIsConfigured(hasKey);
      } else {
        // Fallback for browser testing
        setIsConfigured(false);
      }
    } catch (error) {
      console.error('Error checking API key:', error);
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

  // Always show widget for now (skip setup check)
  return <Widget settings={settings} onSettingsChange={loadSettings} />;
}

export default App;
