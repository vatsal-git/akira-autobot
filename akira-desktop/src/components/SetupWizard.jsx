import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import '../styles/setup.css';

function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(1);
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadProviders();
  }, []);

  const loadProviders = async () => {
    try {
      if (window.akira?.getProviders) {
        const providerList = await window.akira.getProviders();
        setProviders(providerList);
        if (providerList.length > 0) {
          setSelectedProvider(providerList[0].id);
          setSelectedModel(providerList[0].defaultModel);
        }
      }
    } catch (err) {
      console.error('Error loading providers:', err);
    }
  };

  const currentProvider = providers.find(p => p.id === selectedProvider) || {};

  const handleProviderChange = (providerId) => {
    setSelectedProvider(providerId);
    const provider = providers.find(p => p.id === providerId);
    if (provider) {
      setSelectedModel(provider.defaultModel);
    }
    setApiKey('');
    setError('');
  };

  const handleNext = () => {
    if (step === 1 && selectedProvider) {
      setStep(2);
    } else if (step === 2 && apiKey.trim()) {
      setStep(3);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setError('');
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    setError('');

    try {
      await window.akira.setSelectedProvider(selectedProvider);
      await window.akira.setProviderApiKey(selectedProvider, apiKey.trim());
      await window.akira.setSelectedModel(selectedModel);
      onComplete();
    } catch (err) {
      setError(`Error saving settings: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenExternal = (url) => {
    if (window.akira?.openExternal) {
      window.akira.openExternal(url);
    }
  };

  const renderProviderStep = () => (
    <motion.div
      className="setup__step"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <h2 className="setup__step-title">Step 1: Choose a Provider</h2>
      <p className="setup__step-desc">
        Select your AI provider. Each provider requires its own API credentials.
      </p>

      <div className="setup__input-group">
        <label className="setup__label">Provider</label>
        <select
          className="setup__select"
          value={selectedProvider}
          onChange={(e) => handleProviderChange(e.target.value)}
        >
          {providers.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
          ))}
        </select>
      </div>

      {currentProvider.docsUrl && (
        <button
          type="button"
          onClick={() => handleOpenExternal(currentProvider.docsUrl)}
          className="setup__link"
          style={{ display: 'block', marginBottom: '16px', fontSize: '13px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
        >
          Get {currentProvider.name} credentials
        </button>
      )}

      <div className="setup__actions">
        <button
          className="setup__btn setup__btn--primary"
          onClick={handleNext}
          disabled={!selectedProvider}
        >
          Next
        </button>
      </div>
    </motion.div>
  );

  const renderCredentialsStep = () => (
    <motion.div
      className="setup__step"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <h2 className="setup__step-title">Step 2: Enter Credentials</h2>
      <p className="setup__step-desc">
        Enter your {currentProvider.name} credentials to connect.
      </p>

      <div className="setup__input-group">
        <label className="setup__label">API Key</label>
        <input
          type={showApiKey ? 'text' : 'password'}
          className="setup__input"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={currentProvider.apiKeyPlaceholder || 'Enter API key...'}
        />
      </div>

      {error && <div className="setup__error">{error}</div>}

      <div className="setup__actions">
        <button
          className="setup__btn setup__btn--secondary"
          onClick={handleBack}
        >
          Back
        </button>
        <button
          className="setup__btn setup__btn--primary"
          onClick={handleNext}
          disabled={!apiKey.trim()}
        >
          Next
        </button>
      </div>
    </motion.div>
  );

  const renderModelStep = () => (
    <motion.div
      className="setup__step"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <h2 className="setup__step-title">Step 3: Choose a Model</h2>
      <p className="setup__step-desc">
        Enter a model ID or use the default for {currentProvider.name}.
      </p>

      <div className="setup__input-group">
        <label className="setup__label">Model</label>
        <input
          type="text"
          className="setup__input"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          placeholder={currentProvider.defaultModel || 'Enter model ID...'}
        />
      </div>

      <p className="setup__step-desc" style={{ marginTop: '8px', fontSize: '12px' }}>
        Default: {currentProvider.defaultModel}
      </p>

      {error && <div className="setup__error">{error}</div>}

      <div className="setup__actions">
        <button
          className="setup__btn setup__btn--secondary"
          onClick={handleBack}
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
  );

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

        {step === 1 && renderProviderStep()}
        {step === 2 && renderCredentialsStep()}
        {step === 3 && renderModelStep()}

        <div className="setup__footer">
          <div className="setup__steps">
            <div className={`setup__step-dot ${step >= 1 ? 'setup__step-dot--active' : ''}`} />
            <div className={`setup__step-dot ${step >= 2 ? 'setup__step-dot--active' : ''}`} />
            <div className={`setup__step-dot ${step >= 3 ? 'setup__step-dot--active' : ''}`} />
          </div>
        </div>
      </motion.div>
    </div>
  );
}

export default SetupWizard;
