/**
 * LLM Provider Registry
 * Centralized configuration for all supported LLM providers
 */

const providers = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    apiEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiKeyPlaceholder: 'sk-or-...',
    defaultModel: 'openrouter/auto',
    docsUrl: 'https://openrouter.ai/keys',
    supportsTools: true,
    supportsStreaming: true,

    buildHeaders: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://akira.app',
      'X-Title': 'Akira Desktop'
    }),

    transformRequest: null,
    transformResponse: null,
    parseStream: null
  }
};

/**
 * Get provider by ID
 */
function getProvider(providerId) {
  return providers[providerId] || null;
}

/**
 * Get all providers
 */
function getAllProviders() {
  return Object.values(providers);
}

/**
 * Get provider list for UI
 */
function getProviderList() {
  return Object.values(providers).map(p => ({
    id: p.id,
    name: p.name,
    defaultModel: p.defaultModel,
    docsUrl: p.docsUrl,
    apiKeyPlaceholder: p.apiKeyPlaceholder
  }));
}

module.exports = {
  providers,
  getProvider,
  getAllProviders,
  getProviderList
};
