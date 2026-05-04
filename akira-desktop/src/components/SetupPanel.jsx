import React, { useState, useEffect } from 'react';
import '../styles/setup-panel.css';

function SetupPanel({ onComplete }) {
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
      if (selectedProvider === 'openrouter') {
        const success = await window.akira.testConnection(apiKey.trim());
        if (success) {
          setTestResult('success');
        } else {
          setTestResult('failed');
          setError('Connection test failed. Please check your API key.');
        }
      } else {
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
      await window.akira.setSelectedProvider(selectedProvider);
      await window.akira.setProviderApiKey(selectedProvider, apiKey.trim());

      if (selectedProvider === 'bedrock') {
        await window.akira.setBedrockCredentials(bedrockCredentials);
      }

      await window.akira.setSelectedModel(selectedModel);
      onComplete();
    } catch (err) {
      setError(`Error saving settings: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  const renderProviderStep = () => (
    <div className="setup-panel__step">
      <div className="setup-panel__welcome">
        <div className="setup-panel__logo">A</div>
        <h2 className="setup-panel__title">Hi, I'm Akira</h2>
        <p className="setup-panel__subtitle">Let's get you set up</p>
      </div>

      <div className="setup-panel__content">
        <h3 className="setup-panel__step-title">Step 1: Choose a Provider</h3>
        <p className="setup-panel__step-desc">
          Select your AI provider. Each provider requires its own API credentials.
        </p>

        <div className="setup-panel__input-group">
          <label className="setup-panel__label">Provider</label>
          <select
            className="setup-panel__select"
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
            className="setup-panel__link"
          >
            Get {currentProvider.name} credentials
          </a>
        )}
      </div>

      <div className="setup-panel__footer">
        <div className="setup-panel__steps-indicator">
          <div className={`setup-panel__dot ${step >= 1 ? 'setup-panel__dot--active' : ''}`} />
          <div className={`setup-panel__dot ${step >= 2 ? 'setup-panel__dot--active' : ''}`} />
          <div className={`setup-panel__dot ${step >= 3 ? 'setup-panel__dot--active' : ''}`} />
        </div>
        <div className="setup-panel__actions">
          <button
            className="setup-panel__btn setup-panel__btn--primary"
            onClick={handleNext}
            disabled={!selectedProvider}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );

  const renderCredentialsStep = () => (
    <div className="setup-panel__step">
      <div className="setup-panel__content">
        <h3 className="setup-panel__step-title">Step 2: Enter Credentials</h3>
        <p className="setup-panel__step-desc">
          Enter your {currentProvider.name} credentials to connect.
        </p>

        {selectedProvider === 'bedrock' ? (
          <>
            <div className="setup-panel__input-group">
              <label className="setup-panel__label">AWS Access Key ID</label>
              <input
                type={showApiKey ? 'text' : 'password'}
                className="setup-panel__input"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AKIA..."
                disabled={testing}
              />
            </div>

            <div className="setup-panel__input-group">
              <label className="setup-panel__label">AWS Secret Access Key</label>
              <input
                type={showSecretKey ? 'text' : 'password'}
                className="setup-panel__input"
                value={bedrockCredentials.awsSecretAccessKey}
                onChange={(e) => setBedrockCredentials(prev => ({
                  ...prev,
                  awsSecretAccessKey: e.target.value
                }))}
                placeholder="Enter secret key..."
                disabled={testing}
              />
            </div>

            <div className="setup-panel__input-group">
              <label className="setup-panel__label">AWS Region</label>
              <input
                type="text"
                className="setup-panel__input"
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
          <div className="setup-panel__input-group">
            <label className="setup-panel__label">API Key</label>
            <input
              type={showApiKey ? 'text' : 'password'}
              className="setup-panel__input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={currentProvider.apiKeyPlaceholder || 'Enter API key...'}
              disabled={testing}
            />
          </div>
        )}

        {error && <div className="setup-panel__error">{error}</div>}

        {testResult === 'success' && (
          <div className="setup-panel__success">
            Credentials look good!
          </div>
        )}
      </div>

      <div className="setup-panel__footer">
        <div className="setup-panel__steps-indicator">
          <div className={`setup-panel__dot ${step >= 1 ? 'setup-panel__dot--active' : ''}`} />
          <div className={`setup-panel__dot ${step >= 2 ? 'setup-panel__dot--active' : ''}`} />
          <div className={`setup-panel__dot ${step >= 3 ? 'setup-panel__dot--active' : ''}`} />
        </div>
        <div className="setup-panel__actions">
          <button
            className="setup-panel__btn setup-panel__btn--secondary"
            onClick={handleBack}
          >
            Back
          </button>
          <button
            className="setup-panel__btn setup-panel__btn--secondary"
            onClick={handleTestConnection}
            disabled={testing || (!apiKey.trim() && selectedProvider !== 'bedrock') || (selectedProvider === 'bedrock' && (!apiKey.trim() || !bedrockCredentials.awsSecretAccessKey.trim()))}
          >
            {testing ? 'Testing...' : 'Test'}
          </button>
          <button
            className="setup-panel__btn setup-panel__btn--primary"
            onClick={handleNext}
            disabled={testResult !== 'success'}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );

  const renderModelStep = () => (
    <div className="setup-panel__step">
      <div className="setup-panel__content">
        <h3 className="setup-panel__step-title">Step 3: Choose a Model</h3>
        <p className="setup-panel__step-desc">
          Enter a model ID or use the default for {currentProvider.name}.
        </p>

        <div className="setup-panel__input-group">
          <label className="setup-panel__label">Model</label>
          <input
            type="text"
            className="setup-panel__input"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            placeholder={currentProvider.defaultModel || 'Enter model ID...'}
          />
        </div>

        <p className="setup-panel__hint">
          Default: {currentProvider.defaultModel}
        </p>

        {error && <div className="setup-panel__error">{error}</div>}
      </div>

      <div className="setup-panel__footer">
        <div className="setup-panel__steps-indicator">
          <div className={`setup-panel__dot ${step >= 1 ? 'setup-panel__dot--active' : ''}`} />
          <div className={`setup-panel__dot ${step >= 2 ? 'setup-panel__dot--active' : ''}`} />
          <div className={`setup-panel__dot ${step >= 3 ? 'setup-panel__dot--active' : ''}`} />
        </div>
        <div className="setup-panel__actions">
          <button
            className="setup-panel__btn setup-panel__btn--secondary"
            onClick={handleBack}
          >
            Back
          </button>
          <button
            className="setup-panel__btn setup-panel__btn--primary"
            onClick={handleComplete}
            disabled={saving || !selectedModel}
          >
            {saving ? 'Saving...' : 'Get Started'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="setup-panel">
      {step === 1 && renderProviderStep()}
      {step === 2 && renderCredentialsStep()}
      {step === 3 && renderModelStep()}
    </div>
  );
}

export default SetupPanel;
