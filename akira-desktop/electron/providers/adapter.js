/**
 * Provider Adapter
 * Handles LLM API calls with provider-specific request/response handling
 */

const { getProvider } = require('./index');

// Lazy load Bedrock SDK to avoid issues if not installed
let BedrockRuntimeClient = null;
let InvokeModelWithResponseStreamCommand = null;

function loadBedrockSdk() {
  if (!BedrockRuntimeClient) {
    try {
      const bedrock = require('@aws-sdk/client-bedrock-runtime');
      BedrockRuntimeClient = bedrock.BedrockRuntimeClient;
      InvokeModelWithResponseStreamCommand = bedrock.InvokeModelWithResponseStreamCommand;
    } catch (e) {
      console.error('AWS Bedrock SDK not installed. Run: npm install @aws-sdk/client-bedrock-runtime');
      throw new Error('AWS Bedrock SDK not installed');
    }
  }
}

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
    // If not JSON, check if it's an HTML page (e.g. gateway error/Cloudflare protection)
    if (errorText.includes('<html') || errorText.includes('<!DOCTYPE html')) {
      errorMessage = 'Server returned HTML response (e.g. gateway error/Cloudflare protection)';
    }
  }

  // Truncate if still excessively long
  if (errorMessage.length > 500) {
    errorMessage = errorMessage.substring(0, 500) + '...';
  }

  return `${providerName} API error: ${errorMessage}`;
}

/**
 * Call an LLM provider
 * @param {Object} params
 * @param {string} params.providerId - Provider ID (e.g., 'openrouter', 'anthropic', 'bedrock')
 * @param {Array} params.messages - Messages in OpenAI format
 * @param {Array} params.tools - Tools in OpenAI format
 * @param {string} params.apiKey - API key for the provider (or awsAccessKeyId for Bedrock)
 * @param {string} params.model - Model ID
 * @param {number} params.temperature - Temperature setting
 * @param {AbortSignal} params.signal - AbortController signal
 * @param {Function} params.onEvent - Streaming event callback
 * @param {Object} params.credentials - Additional credentials (for Bedrock: awsSecretAccessKey, awsRegion)
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
  credentials = {},
  reasoningEnabled = true
}) {
  const provider = getProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  // Handle Bedrock separately (uses AWS SDK)
  if (provider.usesAwsSdk) {
    return await callBedrock({
      messages,
      tools,
      model,
      temperature,
      maxTokens,
      thinkingBudget,
      signal,
      onEvent,
      awsAccessKeyId: apiKey,
      awsSecretAccessKey: credentials.awsSecretAccessKey,
      awsRegion: credentials.awsRegion || 'us-east-1',
      provider,
      reasoningEnabled
    });
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

  // Process streaming response
  if (provider.parseStream === 'anthropic') {
    return await processAnthropicStream(response, onEvent);
  } else {
    return await processOpenAIStream(response, onEvent);
  }
}

/**
 * Call AWS Bedrock using the AWS SDK
 */
async function callBedrock({
  messages,
  tools,
  model,
  temperature,
  maxTokens,
  thinkingBudget,
  signal,
  onEvent,
  awsAccessKeyId,
  awsSecretAccessKey,
  awsRegion,
  provider,
  reasoningEnabled = true
}) {
  loadBedrockSdk();

  // Create Bedrock client
  const client = new BedrockRuntimeClient({
    region: awsRegion,
    credentials: {
      accessKeyId: awsAccessKeyId,
      secretAccessKey: awsSecretAccessKey
    }
  });

  // Build request body
  const body = provider.transformRequest(messages, tools, { model, temperature, maxTokens, thinkingBudget, reasoningEnabled });

  // Create streaming command
  const command = new InvokeModelWithResponseStreamCommand({
    modelId: model,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body)
  });

  // Handle abort signal
  if (signal?.aborted) {
    throw new Error('Request aborted');
  }

  const response = await client.send(command, { abortSignal: signal });

  // Process Bedrock streaming response
  return await processBedrockStream(response, onEvent);
}

/**
 * Process AWS Bedrock streaming response
 */
async function processBedrockStream(response, onEvent) {
  let content = '';
  let thinking = '';
  const toolCalls = [];
  const thinkingBlocks = [];
  let currentToolUse = null;
  let currentToolInput = '';
  let currentBlockType = null;
  let currentThinkingBlock = null;

  for await (const event of response.body) {
    if (event.chunk) {
      const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));

      switch (chunk.type) {
        case 'content_block_start':
          if (chunk.content_block?.type === 'tool_use') {
            currentToolUse = {
              id: chunk.content_block.id,
              type: 'function',
              function: {
                name: chunk.content_block.name,
                arguments: ''
              }
            };
            currentToolInput = '';
            currentBlockType = 'tool_use';
          } else if (chunk.content_block?.type === 'thinking') {
            currentBlockType = 'thinking';
            currentThinkingBlock = { type: 'thinking', thinking: '' };
          } else if (chunk.content_block?.type === 'redacted_thinking') {
            // Capture redacted_thinking blocks exactly as received
            thinkingBlocks.push({
              type: 'redacted_thinking',
              data: chunk.content_block.data
            });
            currentBlockType = 'redacted_thinking';
          } else if (chunk.content_block?.type === 'text') {
            currentBlockType = 'text';
          }
          break;

        case 'content_block_delta':
          if (chunk.delta?.type === 'text_delta') {
            content += chunk.delta.text;
            onEvent?.({
              type: 'delta',
              delta: chunk.delta.text
            });
          } else if (chunk.delta?.type === 'thinking_delta') {
            thinking += chunk.delta.thinking;
            if (currentThinkingBlock) {
              currentThinkingBlock.thinking += chunk.delta.thinking;
            }
            onEvent?.({
              type: 'reasoning',
              reasoning: chunk.delta.thinking
            });
          } else if (chunk.delta?.type === 'signature_delta') {
            // Capture signature for thinking blocks (required by API for multi-turn)
            if (currentThinkingBlock) {
              currentThinkingBlock.signature = chunk.delta.signature;
            }
          } else if (chunk.delta?.type === 'input_json_delta') {
            currentToolInput += chunk.delta.partial_json;
          }
          break;

        case 'content_block_stop':
          if (currentToolUse) {
            currentToolUse.function.arguments = currentToolInput;
            toolCalls.push(currentToolUse);
            currentToolUse = null;
            currentToolInput = '';
          }
          if (currentThinkingBlock) {
            thinkingBlocks.push(currentThinkingBlock);
            currentThinkingBlock = null;
          }
          currentBlockType = null;
          break;

        case 'message_stop':
          break;

        case 'error':
          throw new Error(`Bedrock error: ${chunk.error?.message || 'Unknown error'}`);
      }
    }
  }

  return { content, toolCalls, thinking, thinkingBlocks };
}

/**
 * Sanitize messages for OpenAI format - removes internal fields like _imageData
 * OpenAI-compatible APIs don't support images in tool results the same way Anthropic does
 */
function sanitizeMessagesForOpenAI(messages) {
  return messages.map(msg => {
    if (msg.role === 'tool' && msg._imageData) {
      // For OpenAI format, include image as data URL in content for models that support vision
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
    // Remove any internal fields starting with _
    const { _imageData, ...clean } = msg;
    return clean;
  });
}

/**
 * Build OpenAI-compatible request body (used by OpenRouter and others)
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
          // Skip malformed chunks
        }
      }
    }
  }

  return {
    content,
    toolCalls: Array.from(toolCallsInProgress.values())
  };
}

/**
 * Process Anthropic SSE stream
 */
async function processAnthropicStream(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let content = '';
  let thinking = '';
  const toolCalls = [];
  const thinkingBlocks = []; // Preserve thinking blocks for conversation history
  let currentToolUse = null;
  let currentToolInput = '';
  let currentThinkingBlock = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;

      if (trimmed.startsWith('event: ')) {
        // Event type line - we'll handle it with the data
        continue;
      }

      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6);
        try {
          const event = JSON.parse(jsonStr);

          switch (event.type) {
            case 'content_block_start':
              if (event.content_block?.type === 'tool_use') {
                currentToolUse = {
                  id: event.content_block.id,
                  type: 'function',
                  function: {
                    name: event.content_block.name,
                    arguments: ''
                  }
                };
                currentToolInput = '';
              } else if (event.content_block?.type === 'thinking') {
                currentThinkingBlock = { type: 'thinking', thinking: '' };
              } else if (event.content_block?.type === 'redacted_thinking') {
                // Capture redacted_thinking blocks exactly as received
                thinkingBlocks.push({
                  type: 'redacted_thinking',
                  data: event.content_block.data
                });
              }
              break;

            case 'content_block_delta':
              if (event.delta?.type === 'text_delta') {
                content += event.delta.text;
                onEvent?.({
                  type: 'delta',
                  delta: event.delta.text
                });
              } else if (event.delta?.type === 'thinking_delta') {
                thinking += event.delta.thinking;
                if (currentThinkingBlock) {
                  currentThinkingBlock.thinking += event.delta.thinking;
                }
                onEvent?.({
                  type: 'reasoning',
                  reasoning: event.delta.thinking
                });
              } else if (event.delta?.type === 'signature_delta') {
                // Capture signature for thinking blocks (required by API for multi-turn)
                if (currentThinkingBlock) {
                  currentThinkingBlock.signature = event.delta.signature;
                }
              } else if (event.delta?.type === 'input_json_delta') {
                currentToolInput += event.delta.partial_json;
              }
              break;

            case 'content_block_stop':
              if (currentToolUse) {
                currentToolUse.function.arguments = currentToolInput;
                toolCalls.push(currentToolUse);
                currentToolUse = null;
                currentToolInput = '';
              }
              if (currentThinkingBlock) {
                thinkingBlocks.push(currentThinkingBlock);
                currentThinkingBlock = null;
              }
              break;

            case 'message_stop':
              // End of message
              break;

            case 'error':
              throw new Error(`Anthropic stream error: ${event.error?.message || 'Unknown error'}`);
          }
        } catch (parseErr) {
          if (parseErr.message?.startsWith('Anthropic stream error')) {
            throw parseErr;
          }
          // Skip malformed chunks
        }
      }
    }
  }

  return {
    content,
    toolCalls,
    thinking,
    thinkingBlocks
  };
}

module.exports = {
  callProvider,
  buildOpenAIRequest,
  processOpenAIStream,
  processAnthropicStream,
  processBedrockStream,
  callBedrock
};
