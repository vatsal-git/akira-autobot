import React, { useState } from 'react';
import { motion } from 'framer-motion';
import '../styles/setup.css';

function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(1);
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleTestConnection = async () => {
    if (!apiKey.trim()) {
      setError('Please enter your API key');
      return;
    }

    setTesting(true);
    setError('');
    setTestResult(null);

    try {
      const success = await window.akira.testConnection(apiKey.trim());
      if (success) {
        setTestResult('success');
        // Fetch available free models
        const modelList = await window.akira.getModels();
        setModels(modelList);
        if (modelList.length > 0) {
          setSelectedModel(modelList[0].id);
        }
      } else {
        setTestResult('failed');
        setError('Connection test failed. Please check your API key.');
      }
    } catch (err) {
      setTestResult('failed');
      setError(`Error: ${err}`);
    } finally {
      setTesting(false);
    }
  };

  const handleNext = () => {
    if (step === 1 && testResult === 'success') {
      setStep(2);
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    setError('');

    try {
      // Save API key
      await window.akira.setApiKey(apiKey.trim());

      // Update settings with selected model
      await window.akira.saveSettings({
        defaultModel: selectedModel,
      });

      onComplete();
    } catch (err) {
      setError(`Error saving settings: ${err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="setup">
      <motion.div
        className="setup__card"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <div className="setup__header">
          <div className="setup__logo">A</div>
          <h1 className="setup__title">Welcome to Akira</h1>
          <p className="setup__subtitle">Let's get you set up</p>
        </div>

        {step === 1 && (
          <motion.div
            className="setup__step"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <h2 className="setup__step-title">Step 1: Connect to OpenRouter</h2>
            <p className="setup__step-desc">
              Akira uses OpenRouter to access AI models. Get your API key from{' '}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="setup__link"
              >
                openrouter.ai/keys
              </a>
            </p>
            <a
              href="https://www.youtube.com/watch?v=_K69Axdo_vc"
              target="_blank"
              rel="noopener noreferrer"
              className="setup__tutorial-link"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
              </svg>
              Watch tutorial: How to get your API key
            </a>

            <div className="setup__input-group">
              <label className="setup__label">API Key</label>
              <input
                type="password"
                className="setup__input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-..."
                disabled={testing}
              />
            </div>

            {error && <div className="setup__error">{error}</div>}

            {testResult === 'success' && (
              <div className="setup__success">
                Connection successful! {models.length} models available.
              </div>
            )}

            <div className="setup__actions">
              <button
                className="setup__btn setup__btn--secondary"
                onClick={handleTestConnection}
                disabled={testing || !apiKey.trim()}
              >
                {testing ? 'Testing...' : 'Test Connection'}
              </button>
              <button
                className="setup__btn setup__btn--primary"
                onClick={handleNext}
                disabled={testResult !== 'success'}
              >
                Next
              </button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            className="setup__step"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <h2 className="setup__step-title">Step 2: Choose a Model</h2>
            <p className="setup__step-desc">
              Select a default model to use.
            </p>

            <div className="setup__input-group">
              <label className="setup__label">Default Model</label>
              <select
                className="setup__select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name || model.id}
                  </option>
                ))}
              </select>
            </div>

            {error && <div className="setup__error">{error}</div>}

            <div className="setup__actions">
              <button
                className="setup__btn setup__btn--secondary"
                onClick={() => setStep(1)}
              >
                Back
              </button>
              <button
                className="setup__btn setup__btn--primary"
                onClick={handleComplete}
                disabled={saving || !selectedModel}
              >
                {saving ? 'Saving...' : 'Get Started'}
              </button>
            </div>
          </motion.div>
        )}

        <div className="setup__footer">
          <div className="setup__steps">
            <div className={`setup__step-dot ${step >= 1 ? 'setup__step-dot--active' : ''}`} />
            <div className={`setup__step-dot ${step >= 2 ? 'setup__step-dot--active' : ''}`} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default SetupWizard;
