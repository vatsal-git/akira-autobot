/**
 * Desktop Analyze Image Tool
 * Stateless image analysis using Claude vision - no conversation history, just image + prompt
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runPowerShell, getScreenSize } = require('../utils/powershell');
const { analyzeImage, findElement, compareImages } = require('../utils/bedrock-vision');

/**
 * Capture a screenshot region
 */
async function captureRegion(region) {
  const { left, top, width, height } = region;
  const tempFile = path.join(os.tmpdir(), `analyze_img_${Date.now()}.png`);

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
    $bitmap = New-Object System.Drawing.Bitmap(${width}, ${height})
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen(${left}, ${top}, 0, 0, (New-Object System.Drawing.Size(${width}, ${height})))
    $bitmap.Save("${tempFile}")
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Output "OK"
} catch {
    Write-Host "EXCEPTION: $($_.Exception.Message)"
    exit 1
}
`;

  await runPowerShell(script, { timeout: 15000 });

  if (!fs.existsSync(tempFile)) {
    throw new Error('Failed to capture screenshot region');
  }

  const imageBuffer = fs.readFileSync(tempFile);
  const base64 = imageBuffer.toString('base64');

  try { fs.unlinkSync(tempFile); } catch {}

  return base64;
}

/**
 * Capture full screen
 */
async function captureFullScreen() {
  const screenSize = await getScreenSize();
  return await captureRegion({
    left: 0,
    top: 0,
    width: screenSize.width,
    height: screenSize.height
  });
}

/**
 * Main handler
 */
async function desktopAnalyzeImage(input) {
  const { action, region, image_base64, prompt, output_format = 'structured', center_x, center_y } = input;

  if (!prompt) {
    return { success: false, error: 'prompt is required - describe what to analyze/find in the image' };
  }

  let imageBase64 = image_base64;

  // Determine the image source
  if (action === 'analyze_region') {
    if (!region) {
      return { success: false, error: 'region is required for analyze_region action (left, top, width, height)' };
    }
    if (region.left == null || region.top == null || region.width == null || region.height == null) {
      return { success: false, error: 'region must have left, top, width, and height' };
    }
    imageBase64 = await captureRegion(region);
  } else if (action === 'analyze_full_screen') {
    imageBase64 = await captureFullScreen();
  } else if (action === 'analyze_base64') {
    if (!image_base64) {
      return { success: false, error: 'image_base64 is required for analyze_base64 action' };
    }
  } else if (action === 'find_element') {
    // Special action to find an element and return coordinates
    if (!region && !image_base64) {
      return { success: false, error: 'Either region or image_base64 is required for find_element' };
    }

    if (region) {
      imageBase64 = await captureRegion(region);
    }

    // Calculate image center for coordinate mapping
    const imgCenterX = center_x ?? (region ? region.left + Math.floor(region.width / 2) : 0);
    const imgCenterY = center_y ?? (region ? region.top + Math.floor(region.height / 2) : 0);

    const result = await findElement({
      imageBase64,
      elementDescription: prompt,
      imageCenterX: imgCenterX,
      imageCenterY: imgCenterY
    });

    return {
      success: true,
      action: 'find_element',
      result
    };
  } else if (action === 'compare') {
    // Compare two images
    const { before_base64, after_base64, expected_change } = input;
    if (!before_base64 || !after_base64) {
      return { success: false, error: 'before_base64 and after_base64 are required for compare action' };
    }
    if (!expected_change) {
      return { success: false, error: 'expected_change is required for compare action' };
    }

    const result = await compareImages({
      beforeBase64: before_base64,
      afterBase64: after_base64,
      expectedChange: expected_change
    });

    return {
      success: true,
      action: 'compare',
      result
    };
  } else if (!action || action === 'analyze') {
    // Default: analyze whatever image is provided
    if (!image_base64 && !region) {
      // Capture full screen if nothing specified
      imageBase64 = await captureFullScreen();
    } else if (region) {
      imageBase64 = await captureRegion(region);
    }
  } else {
    return { success: false, error: `Unknown action: ${action}. Use analyze, analyze_region, analyze_full_screen, analyze_base64, find_element, or compare.` };
  }

  // Perform analysis
  try {
    const result = await analyzeImage({
      imageBase64,
      prompt,
      outputFormat: output_format
    });

    return {
      success: true,
      action: action || 'analyze',
      output_format,
      result
    };
  } catch (error) {
    return {
      success: false,
      error: `Analysis failed: ${error.message}`
    };
  }
}

const definitions = [
  {
    name: 'desktop_analyze_image',
    description: 'Analyze a screen region or image using Claude vision. Stateless - no conversation history, just image + prompt. Returns structured JSON or free-form text. Use for UI understanding, finding elements, or comparing before/after states.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['analyze', 'analyze_region', 'analyze_full_screen', 'analyze_base64', 'find_element', 'compare'],
          description: 'What to do: analyze (auto-detect), analyze_region (capture region), analyze_full_screen, analyze_base64 (use provided image), find_element (locate element and return coords), compare (diff two images)'
        },
        region: {
          type: 'object',
          properties: {
            left: { type: 'number', description: 'Left edge X coordinate' },
            top: { type: 'number', description: 'Top edge Y coordinate' },
            width: { type: 'number', description: 'Region width in pixels' },
            height: { type: 'number', description: 'Region height in pixels' }
          },
          description: 'Screen region to capture (for analyze_region or find_element)'
        },
        image_base64: {
          type: 'string',
          description: 'Base64 encoded PNG image (for analyze_base64)'
        },
        prompt: {
          type: 'string',
          description: 'What to analyze or find in the image (e.g., "What buttons are visible?", "Find the Submit button", "Is there a login form?")'
        },
        output_format: {
          type: 'string',
          enum: ['structured', 'text'],
          description: 'Output format: structured (JSON with found, confidence, description, suggested_coords) or text (free-form description). Default: structured'
        },
        center_x: {
          type: 'number',
          description: 'For find_element: screen X coordinate of image center (for coordinate mapping)'
        },
        center_y: {
          type: 'number',
          description: 'For find_element: screen Y coordinate of image center (for coordinate mapping)'
        },
        before_base64: {
          type: 'string',
          description: 'For compare action: before state image (base64)'
        },
        after_base64: {
          type: 'string',
          description: 'For compare action: after state image (base64)'
        },
        expected_change: {
          type: 'string',
          description: 'For compare action: what change to look for'
        }
      },
      required: ['prompt']
    }
  }
];

const handlers = {
  desktop_analyze_image: desktopAnalyzeImage
};

module.exports = { definitions, handlers };
