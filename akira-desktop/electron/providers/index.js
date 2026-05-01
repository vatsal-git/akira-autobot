/**
 * LLM Provider Registry
 * Centralized configuration for all supported LLM providers
 */

// Provider type constants
const PROVIDER_TYPES = {
  OPENAI_COMPATIBLE: 'openai',
  ANTHROPIC: 'anthropic',
  BEDROCK: 'bedrock'
};

const providers = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    apiEndpoint: 'https://api.openai.com/v1/chat/completions',
    apiKeyPlaceholder: 'sk-...',
    defaultModel: 'gpt-4o',
    docsUrl: 'https://platform.openai.com/api-keys',
    supportsTools: true,
    supportsStreaming: true,

    buildHeaders: (apiKey) => ({
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }),

    // OpenAI native format (default)
    transformRequest: null,
    transformResponse: null,
    parseStream: null
  },

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

    // OpenRouter uses OpenAI-compatible format (default)
    transformRequest: null,
    transformResponse: null,
    parseStream: null
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    apiEndpoint: 'https://api.anthropic.com/v1/messages',
    apiKeyPlaceholder: 'sk-ant-...',
    defaultModel: 'claude-sonnet-4-20250514',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    supportsTools: true,
    supportsStreaming: true,

    buildHeaders: (apiKey) => ({
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    }),

    // Anthropic Messages API format
    transformRequest: (messages, tools, config) => {
      // Extract system message
      const systemMessage = messages.find(m => m.role === 'system');
      const conversationMessages = messages.filter(m => m.role !== 'system');

      const thinkingEnabled = config.reasoningEnabled !== false;

      // Convert messages to Anthropic format
      const anthropicMessages = convertToAnthropicMessages(conversationMessages, thinkingEnabled);

      // Convert tools to Anthropic format
      const anthropicTools = tools?.length > 0 ? convertToAnthropicTools(tools) : undefined;

      // API requires budget_tokens >= 1024
      const budgetTokens = Math.max(config.thinkingBudget || 10000, 1024);
      // max_tokens must be greater than budget_tokens when thinking is enabled
      let maxTokens = config.maxTokens || (thinkingEnabled ? budgetTokens + 8192 : 8192);
      // Ensure max_tokens > budget_tokens when thinking is enabled
      if (thinkingEnabled && maxTokens <= budgetTokens) {
        maxTokens = budgetTokens + 8192;
      }

      const request = {
        model: config.model,
        max_tokens: maxTokens,
        system: systemMessage?.content || '',
        messages: anthropicMessages,
        tools: anthropicTools,
        stream: true
      };

      // Add extended thinking if enabled
      if (thinkingEnabled) {
        request.thinking = {
          type: 'enabled',
          budget_tokens: budgetTokens
        };
      }

      return request;
    },

    parseStream: 'anthropic'
  },

  bedrock: {
    id: 'bedrock',
    name: 'AWS Bedrock',
    providerType: PROVIDER_TYPES.BEDROCK,
    apiKeyPlaceholder: 'AWS Access Key ID',
    // Bedrock uses multiple credentials
    credentials: ['awsAccessKeyId', 'awsSecretAccessKey', 'awsRegion', 'bedrockModelId'],
    defaultModel: 'us.anthropic.claude-sonnet-4-20250514-v1:0',
    defaultRegion: 'us-east-1',
    docsUrl: 'https://console.aws.amazon.com/bedrock',
    supportsTools: true,
    supportsStreaming: true,

    // Bedrock uses AWS SDK, not direct fetch
    usesAwsSdk: true,

    // Transform messages to Anthropic format (Bedrock uses same format)
    transformRequest: (messages, tools, config) => {
      const systemMessage = messages.find(m => m.role === 'system');
      const conversationMessages = messages.filter(m => m.role !== 'system');
      const thinkingEnabled = config.reasoningEnabled !== false;
      const anthropicMessages = convertToAnthropicMessages(conversationMessages, thinkingEnabled);
      const anthropicTools = tools?.length > 0 ? convertToAnthropicTools(tools) : undefined;
      // API requires budget_tokens >= 1024
      const budgetTokens = Math.max(config.thinkingBudget || 10000, 1024);
      // max_tokens must be greater than budget_tokens when thinking is enabled
      let maxTokens = config.maxTokens || (thinkingEnabled ? budgetTokens + 8192 : 8192);
      // Ensure max_tokens > budget_tokens when thinking is enabled
      if (thinkingEnabled && maxTokens <= budgetTokens) {
        maxTokens = budgetTokens + 8192;
      }

      const request = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: maxTokens,
        system: systemMessage?.content || '',
        messages: anthropicMessages,
        tools: anthropicTools
      };

      // Add extended thinking if enabled
      if (thinkingEnabled) {
        request.thinking = {
          type: 'enabled',
          budget_tokens: budgetTokens
        };
      }

      return request;
    },

    parseStream: 'bedrock'
  }
};

/**
 * Convert OpenAI-format messages to Anthropic format
 * @param {Array} messages - Messages in OpenAI format
 * @param {boolean} thinkingEnabled - Whether extended thinking is enabled
 */
function convertToAnthropicMessages(messages, thinkingEnabled = false) {
  const result = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({
        role: 'user',
        content: msg.content
      });
    } else if (msg.role === 'assistant') {
      // Handle assistant messages - must include thinking blocks first when thinking is enabled
      const content = [];

      // Add thinking block first when thinking is enabled (required for extended thinking)
      // Use redacted_thinking for historical messages since we don't store the signature
      // required for full thinking blocks. The signature is a security measure to prevent
      // injection of thinking content.
      if (thinkingEnabled) {
        content.push({ type: 'redacted_thinking', data: 'cmVkYWN0ZWQ=' });
      }

      // Add text content if present
      if (msg.content) {
        content.push({ type: 'text', text: msg.content });
      }

      // Add tool use blocks if present
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const toolCall of msg.tool_calls) {
          let input = {};
          try {
            input = JSON.parse(toolCall.function.arguments || '{}');
          } catch (e) {
            input = {};
          }

          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input
          });
        }
      }

      // Use content array format when thinking is enabled or when we have tool_calls
      if (thinkingEnabled || (msg.tool_calls && msg.tool_calls.length > 0)) {
        result.push({ role: 'assistant', content });
      } else if (msg.thinking) {
        // Has thinking but thinking not enabled globally - still use array format
        result.push({ role: 'assistant', content });
      } else {
        result.push({
          role: 'assistant',
          content: msg.content || ''
        });
      }
    } else if (msg.role === 'tool') {
      // Tool results - need to be in a user message in Anthropic format
      // Find or create a user message for tool results
      const lastMsg = result[result.length - 1];

      // Build tool result content - handle images specially
      let toolResultContent;
      if (msg._imageData) {
        // Include both text summary and image in content array
        toolResultContent = [
          { type: 'text', text: msg.content || 'Image captured' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: msg._imageData.mediaType || 'image/png',
              data: msg._imageData.base64
            }
          }
        ];
      } else {
        toolResultContent = msg.content;
      }

      const toolResultBlock = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id,
        content: toolResultContent
      };

      if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) {
        // Append to existing user message with tool results
        lastMsg.content.push(toolResultBlock);
      } else {
        // Create new user message with tool result
        result.push({
          role: 'user',
          content: [toolResultBlock]
        });
      }
    }
  }

  return result;
}

/**
 * Convert OpenAI-format tools to Anthropic format
 */
function convertToAnthropicTools(tools) {
  return tools.map(tool => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters
  }));
}

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
    apiKeyPlaceholder: p.apiKeyPlaceholder,
    // Bedrock-specific
    credentials: p.credentials,
    defaultRegion: p.defaultRegion,
    usesAwsSdk: p.usesAwsSdk
  }));
}

module.exports = {
  providers,
  PROVIDER_TYPES,
  getProvider,
  getAllProviders,
  getProviderList,
  convertToAnthropicMessages,
  convertToAnthropicTools
};
