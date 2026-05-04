import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import '../styles/setup.css';

function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(1);
  const [providers, setProviders] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [bedrockCredentials, setBedrockCredentials] = useState({
    awsSecretAccessKey: '',
    awsRegion: 'us-east-1'
  });
  const [showSecretKey, setShowSecretKey] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
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
    setBedrockCredentials({ awsSecretAccessKey: '', awsRegion: 'us-east-1' });
    setTestResult(null);
    setError('');
  };

  const handleTestConnection = async () => {
    if (selectedProvider === 'bedrock') {
      if (!apiKey.trim() || !bedrockCredentials.awsSecretAccessKey.trim()) {
        setError('Please enter both AWS Access Key ID and Secret Access Key');
        return;
      }
    } else if (!apiKey.trim()) {
      setError('Please enter your API key');
      return;
    }

    setTesting(true);
    setError('');
    setTestResult(null);

    try {
      // For now, we just validate that credentials are provided
      // A more robust validation would require provider-specific test endpoints
      if (selectedProvider === 'openrouter') {
        const success = await window.akira.testConnection(apiKey.trim());
        if (success) {
          setTestResult('success');
        } else {
          setTestResult('failed');
          setError('Connection test failed. Please check your API key.');
        }
      } else {
        // For other providers, we trust the credentials format
        // Real validation happens on first API call
        setTestResult('success');
      }
    } catch (err) {
      setTestResult('failed');
      setError(`Error: ${err.message || err}`);
    } finally {
      setTesting(false);
    }
  };

  const handleNext = () => {
    if (step === 1 && selectedProvider) {
      setStep(2);
    } else if (step === 2 && testResult === 'success') {
      setStep(3);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
      setTestResult(null);
      setError('');
    }
  };

  const handleComplete = async () => {
    setSaving(true);
    setError('');

    try {
      // Save provider selection
      await window.akira.setSelectedProvider(selectedProvider);

      // Save API key for the provider
      await window.akira.setProviderApiKey(selectedProvider, apiKey.trim());

      // Save Bedrock credentials if applicable
      if (selectedProvider === 'bedrock') {
        await window.akira.setBedrockCredentials(bedrockCredentials);
      }

      // Save selected model
      await window.akira.setSelectedModel(selectedModel);

      onComplete();
    } catch (err) {
      setError(`Error saving settings: ${err.message || err}`);
    } finally {
      setSaving(false);
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
        <a
          href={currentProvider.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="setup__link"
          style={{ display: 'block', marginBottom: '16px', fontSize: '13px' }}
        >
          Get {currentProvider.name} credentials
        </a>
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

      {selectedProvider === 'bedrock' ? (
        <>
          <div className="setup__input-group">
            <label className="setup__label">AWS Access Key ID</label>
            <input
              type={showApiKey ? 'text' : 'password'}
              className="setup__input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AKIA..."
              disabled={testing}
            />
          </div>

          <div className="setup__input-group">
            <label className="setup__label">AWS Secret Access Key</label>
            <input
              type={showSecretKey ? 'text' : 'password'}
              className="setup__input"
              value={bedrockCredentials.awsSecretAccessKey}
              onChange={(e) => setBedrockCredentials(prev => ({
                ...prev,
                awsSecretAccessKey: e.target.value
              }))}
              placeholder="Enter secret key..."
              disabled={testing}
            />
          </div>

          <div className="setup__input-group">
            <label className="setup__label">AWS Region</label>
            <input
              type="text"
              className="setup__input"
              value={bedrockCredentials.awsRegion}
              onChange={(e) => setBedrockCredentials(prev => ({
                ...prev,
                awsRegion: e.target.value
              }))}
              placeholder="us-east-1"
              disabled={testing}
            />
          </div>
        </>
      ) : (
        <div className="setup__input-group">
          <label className="setup__label">API Key</label>
          <input
            type={showApiKey ? 'text' : 'password'}
            className="setup__input"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={currentProvider.apiKeyPlaceholder || 'Enter API key...'}
            disabled={testing}
          />
        </div>
      )}

      {error && <div className="setup__error">{error}</div>}

      {testResult === 'success' && (
        <div className="setup__success">
          Credentials look good!
        </div>
      )}

      <div className="setup__actions">
        <button
          className="setup__btn setup__btn--secondary"
          onClick={handleBack}
        >
          Back
        </button>
        <button
          className="setup__btn setup__btn--secondary"
          onClick={handleTestConnection}
          disabled={testing || (!apiKey.trim() && selectedProvider !== 'bedrock') || (selectedProvider === 'bedrock' && (!apiKey.trim() || !bedrockCredentials.awsSecretAccessKey.trim()))}
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
