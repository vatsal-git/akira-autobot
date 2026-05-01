/**
 * Bedrock Vision Utility
 * Stateless Claude vision API calls for image analysis without conversation history
 * Gets credentials from the existing agent system's apiConfig
 */

// Lazy load to avoid circular dependency
let _initModule = null;
function getInitModule() {
  if (!_initModule) {
    _initModule = require('../../agents/init');
  }
  return _initModule;
}

// Lazy load Bedrock SDK
let BedrockRuntimeClient = null;
let InvokeModelCommand = null;

function loadBedrockSdk() {
  if (!BedrockRuntimeClient) {
    try {
      const bedrock = require('@aws-sdk/client-bedrock-runtime');
      BedrockRuntimeClient = bedrock.BedrockRuntimeClient;
      InvokeModelCommand = bedrock.InvokeModelCommand;
    } catch (e) {
      console.error('[bedrock-vision] AWS Bedrock SDK not installed');
      throw new Error('AWS Bedrock SDK not installed');
    }
  }
}

/**
 * Get credentials from the current API config
 */
function getCredentialsFromConfig() {
  const { getCurrentApiConfig } = getInitModule();
  const config = getCurrentApiConfig();
  if (!config) {
    throw new Error('API not configured. Please ensure the agent system is initialized.');
  }
  if (config.provider !== 'bedrock') {
    throw new Error(`Vision analysis requires Bedrock provider. Current provider: ${config.provider}`);
  }

  return {
    accessKeyId: config.apiKey,
    secretAccessKey: config.credentials?.awsSecretAccessKey,
    region: config.credentials?.awsRegion || 'us-east-1',
    model: config.model
  };
}

/**
 * Make a stateless vision analysis call to Bedrock
 * @param {Object} params
 * @param {string} params.imageBase64 - Base64 encoded PNG image
 * @param {string} params.prompt - What to analyze in the image
 * @param {string} params.outputFormat - 'structured' for JSON or 'text' for free-form
 * @param {string} params.systemPrompt - Optional custom system prompt
 * @returns {Promise<Object>} Analysis result
 */
async function analyzeImage({ imageBase64, prompt, outputFormat = 'structured', systemPrompt = null }) {
  loadBedrockSdk();
  const creds = getCredentialsFromConfig();

  const client = new BedrockRuntimeClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey
    }
  });

  // Build system prompt based on output format
  let system = systemPrompt;
  if (!system) {
    if (outputFormat === 'structured') {
      system = `You are a precise UI analysis assistant. Analyze the image and respond ONLY with valid JSON in this exact format:
{
  "found": boolean,
  "confidence": number between 0 and 1,
  "description": "brief description of what you see",
  "element_type": "button|link|input|icon|text|menu|other|none",
  "suggested_coords": {"x": number, "y": number} or null
}
Where suggested_coords are pixel offsets from the image center (positive x = right, positive y = down).
Do not include any text outside the JSON object.`;
    } else {
      system = 'You are a UI analysis assistant. Describe what you see in the image concisely.';
    }
  }

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    system: system,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/png',
            data: imageBase64
          }
        },
        {
          type: 'text',
          text: prompt
        }
      ]
    }]
  };

  const command = new InvokeModelCommand({
    modelId: creds.model,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body)
  });

  try {
    const response = await client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    const textContent = result.content?.find(c => c.type === 'text')?.text || '';

    if (outputFormat === 'structured') {
      try {
        const jsonMatch = textContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        return {
          found: false,
          confidence: 0,
          description: textContent,
          element_type: 'none',
          suggested_coords: null
        };
      } catch (parseError) {
        console.warn('[bedrock-vision] Failed to parse structured response:', parseError.message);
        return {
          found: false,
          confidence: 0,
          description: textContent,
          element_type: 'none',
          suggested_coords: null
        };
      }
    }

    return { text: textContent };

  } catch (error) {
    console.error('[bedrock-vision] API call failed:', error.message);
    throw error;
  }
}

/**
 * Compare two images and analyze what changed
 * @param {Object} params
 * @param {string} params.beforeBase64 - Base64 PNG of before state
 * @param {string} params.afterBase64 - Base64 PNG of after state
 * @param {string} params.expectedChange - Description of expected change
 * @returns {Promise<Object>} Comparison result
 */
async function compareImages({ beforeBase64, afterBase64, expectedChange }) {
  loadBedrockSdk();
  const creds = getCredentialsFromConfig();

  const client = new BedrockRuntimeClient({
    region: creds.region,
    credentials: {
      accessKeyId: creds.accessKeyId,
      secretAccessKey: creds.secretAccessKey
    }
  });

  const system = `You are a UI change detection assistant. Compare the before and after images and respond ONLY with valid JSON:
{
  "changed": boolean,
  "change_detected": "description of what changed",
  "expected_change_occurred": boolean,
  "confidence": number between 0 and 1
}
Do not include any text outside the JSON object.`;

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 1024,
    system: system,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'BEFORE image:' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: beforeBase64 }
        },
        { type: 'text', text: 'AFTER image:' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/png', data: afterBase64 }
        },
        {
          type: 'text',
          text: `Expected change: "${expectedChange}". Did this change occur? Compare the images carefully.`
        }
      ]
    }]
  };

  const command = new InvokeModelCommand({
    modelId: creds.model,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body)
  });

  try {
    const response = await client.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    const textContent = result.content?.find(c => c.type === 'text')?.text || '';

    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch {}

    return {
      changed: false,
      change_detected: textContent,
      expected_change_occurred: false,
      confidence: 0
    };

  } catch (error) {
    console.error('[bedrock-vision] Compare images failed:', error.message);
    throw error;
  }
}

/**
 * Find an element in an image and return its coordinates
 * @param {Object} params
 * @param {string} params.imageBase64 - Base64 PNG image
 * @param {string} params.elementDescription - What element to find
 * @param {number} params.imageCenterX - Screen X coordinate of image center
 * @param {number} params.imageCenterY - Screen Y coordinate of image center
 * @returns {Promise<Object>} Element location result
 */
async function findElement({ imageBase64, elementDescription, imageCenterX, imageCenterY }) {
  const prompt = `Find the "${elementDescription}" in this image.
The image center corresponds to screen coordinates (${imageCenterX}, ${imageCenterY}).
If you find the element, provide its position as pixel offsets from the image center:
- positive offset_x means the element is to the RIGHT of center
- positive offset_y means the element is BELOW center
- negative offset_x means the element is to the LEFT of center
- negative offset_y means the element is ABOVE center

Look carefully at the entire image. The element might be a button, link, icon, menu item, or text.`;

  const result = await analyzeImage({
    imageBase64,
    prompt,
    outputFormat: 'structured'
  });

  // Calculate absolute screen coordinates if element was found
  if (result.found && result.suggested_coords) {
    result.screen_coords = {
      x: imageCenterX + (result.suggested_coords.x || 0),
      y: imageCenterY + (result.suggested_coords.y || 0)
    };
  }

  return result;
}

/**
 * Verify if a specific element is at the center of an image
 * @param {Object} params
 * @param {string} params.imageBase64 - Base64 PNG image (should be small, ~200x200)
 * @param {string} params.elementDescription - What element should be at center
 * @returns {Promise<Object>} Verification result
 */
async function verifyElementAtCenter({ imageBase64, elementDescription }) {
  const prompt = `Is there a "${elementDescription}" at or very near the CENTER of this image?
The element should be within about 20-30 pixels of the exact center to count as "at center".
Be strict - if the element is clearly off to one side, it's not at center.`;

  return await analyzeImage({
    imageBase64,
    prompt,
    outputFormat: 'structured'
  });
}

module.exports = {
  analyzeImage,
  compareImages,
  findElement,
  verifyElementAtCenter
};
