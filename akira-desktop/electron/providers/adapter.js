/**
 * Provider Adapter
 * Handles LLM API calls with provider-specific request/response handling
 */

const { getProvider } = require('./index');

/**
 * Format raw error text from API into a cleaner, human-readable error message
 */
function formatApiError(errorText, providerName) {
  let errorMessage = errorText;
  try {
    const parsed = JSON.parse(errorText);
    if (parsed) {
      if (parsed.error && typeof parsed.error.message === 'string') {
        errorMessage = parsed.error.message;
      } else if (typeof parsed.message === 'string') {
        errorMessage = parsed.message;
      } else if (parsed.error && typeof parsed.error === 'string') {
        errorMessage = parsed.error;
      }
    }
  } catch (e) {
    if (errorText.includes('<html') || errorText.includes('<!DOCTYPE html')) {
      errorMessage = 'Server returned HTML response (e.g. gateway error/Cloudflare protection)';
    }
  }

  if (errorMessage.length > 500) {
    errorMessage = errorMessage.substring(0, 500) + '...';
  }

  return `${providerName} API error: ${errorMessage}`;
}

/**
 * Call an LLM provider
 * @param {Object} params
 * @param {string} params.providerId - Provider ID (e.g., 'openrouter')
 * @param {Array} params.messages - Messages in OpenAI format
 * @param {Array} params.tools - Tools in OpenAI format
 * @param {string} params.apiKey - API key for the provider
 * @param {string} params.model - Model ID
 * @param {number} params.temperature - Temperature setting
 * @param {AbortSignal} params.signal - AbortController signal
 * @param {Function} params.onEvent - Streaming event callback
 * @returns {Promise<Object>} Response with content and toolCalls
 */
async function callProvider({
  providerId,
  messages,
  tools,
  apiKey,
  model,
  temperature = 0.7,
  maxTokens,
  thinkingBudget,
  signal,
  onEvent,
  reasoningEnabled = true
}) {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  // Build request body
  const body = provider.transformRequest
    ? provider.transformRequest(messages, tools, { model, temperature, maxTokens, thinkingBudget, reasoningEnabled })
    : buildOpenAIRequest(messages, tools, { model, temperature });

  // Make API call
  const response = await fetch(provider.apiEndpoint, {
    method: 'POST',
    headers: provider.buildHeaders(apiKey),
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(formatApiError(errorText, provider.name));
  }

  // Process streaming response (OpenAI-compatible format)
  return await processOpenAIStream(response, onEvent);
}

/**
 * Sanitize messages for OpenAI format - removes internal fields like _imageData
 */
function sanitizeMessagesForOpenAI(messages) {
  return messages.map(msg => {
    if (msg.role === 'tool' && msg._imageData) {
      const { _imageData, ...rest } = msg;
      return {
        ...rest,
        content: [
          { type: 'text', text: msg.content || 'Image captured' },
          {
            type: 'image_url',
            image_url: {
              url: `data:${_imageData.mediaType || 'image/png'};base64,${_imageData.base64}`
            }
          }
        ]
      };
    }
    const { _imageData, ...clean } = msg;
    return clean;
  });
}

/**
 * Build OpenAI-compatible request body (used by OpenRouter)
 */
function buildOpenAIRequest(messages, tools, config) {
  return {
    model: config.model,
    messages: sanitizeMessagesForOpenAI(messages),
    tools: tools?.length > 0 ? tools : undefined,
    tool_choice: tools?.length > 0 ? 'auto' : undefined,
    temperature: config.temperature,
    stream: true
  };
}

/**
 * Process OpenAI-compatible SSE stream (OpenRouter, OpenAI, etc.)
 */
async function processOpenAIStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let content = '';
  const toolCallsInProgress = new Map();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed === 'data: [DONE]') continue;

      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6);
        try {
          const chunk = JSON.parse(jsonStr);
          if (chunk.error) {
            throw new Error(`OpenAI stream error: ${chunk.error.message || JSON.stringify(chunk.error)}`);
          }
          const delta = chunk.choices?.[0]?.delta;

          if (delta) {
            // Handle content
            if (delta.content) {
              content += delta.content;
              onEvent?.({
                type: 'delta',
                delta: delta.content
              });
            }

            // Handle reasoning/thinking
            if (delta.reasoning || delta.thinking) {
              const reasoning = delta.reasoning || delta.thinking;
              onEvent?.({
                type: 'reasoning',
                reasoning
              });
            }

            // Handle tool calls
            if (delta.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const idx = toolCallDelta.index;
                if (!toolCallsInProgress.has(idx)) {
                  toolCallsInProgress.set(idx, {
                    id: toolCallDelta.id || '',
                    type: toolCallDelta.type || 'function',
                    function: {
                      name: toolCallDelta.function?.name || '',
                      arguments: toolCallDelta.function?.arguments || ''
                    }
                  });
                } else {
                  const tc = toolCallsInProgress.get(idx);
                  if (toolCallDelta.id) tc.id = toolCallDelta.id;
                  if (toolCallDelta.function?.name) tc.function.name += toolCallDelta.function.name;
                  if (toolCallDelta.function?.arguments) tc.function.arguments += toolCallDelta.function.arguments;
                }
              }
            }
          }
        } catch (parseErr) {
          if (parseErr.message?.startsWith('OpenAI stream error')) {
            throw parseErr;
          }
        }
      }
    }
  }

  return {
    content,
    toolCalls: Array.from(toolCallsInProgress.values())
  };
}

module.exports = {
  callProvider,
  buildOpenAIRequest,
  processOpenAIStream
};
