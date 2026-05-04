/**
 * Desktop Smart Click Tool
 * Click with visual verification - captures region around target, verifies element,
 * clicks, then verifies action succeeded. Includes retry logic with zoom-out search.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runPowerShell, getScreenSize } = require('../utils/powershell');
const { analyzeImage, compareImages, findElement, verifyElementAtCenter } = require('../utils/bedrock-vision');

// Constants
const VERIFY_REGION_SIZE = 200;      // Pre-click verification region
const SEARCH_REGION_SIZES = [500, 800, 1200];  // Expanding search sizes
const POST_CLICK_REGION_SIZE = 400;  // Post-click verification region
const CONFIDENCE_THRESHOLD = 0.75;   // Minimum confidence to proceed
const CLICK_DELAY_MS = 300;          // Wait after click for UI to update
const MAX_RETRIES_DEFAULT = 3;

/**
 * Capture a screenshot region centered on coordinates
 * @param {number} centerX - Center X coordinate
 * @param {number} centerY - Center Y coordinate
 * @param {number} size - Region size (width = height = size)
 * @returns {Promise<{base64: string, region: Object}>}
 */
async function captureRegion(centerX, centerY, size) {
  const half = Math.floor(size / 2);
  const screenSize = await getScreenSize();

  // Calculate region bounds, clamping to screen
  const left = Math.max(0, Math.min(centerX - half, screenSize.width - size));
  const top = Math.max(0, Math.min(centerY - half, screenSize.height - size));
  const width = Math.min(size, screenSize.width - left);
  const height = Math.min(size, screenSize.height - top);

  const tempFile = path.join(os.tmpdir(), `smart_click_${Date.now()}.png`);

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

  // Cleanup
  try { fs.unlinkSync(tempFile); } catch {}

  return {
    base64,
    region: { left, top, width, height },
    center: {
      x: left + Math.floor(width / 2),
      y: top + Math.floor(height / 2)
    }
  };
}

/**
 * Execute a mouse click at coordinates
 */
async function executeClick(x, y, button = 'left') {
  const moveScript = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
    Start-Sleep -Milliseconds 50
  `;
  await runPowerShell(moveScript);

  const clickFlags = button === 'right'
    ? '0x0008, 0, 0, 0, 0); $t::mouse_event(0x0010'
    : '0x0002, 0, 0, 0, 0); $t::mouse_event(0x0004';

  const clickScript = `
    $signature='[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int info);'
    $t=Add-Type -MemberDefinition $signature -Name SendMouseClick -Namespace Win32 -PassThru
    $t::mouse_event(${clickFlags}, 0, 0, 0, 0)
  `;
  await runPowerShell(clickScript);

  return { clicked: true, x, y, button };
}

/**
 * Verify an element is at the target coordinates
 * @returns {Promise<{verified: boolean, confidence: number, message: string}>}
 */
async function verifyElementPresent(x, y, elementDescription) {
  console.log(`[smart-click] Verifying "${elementDescription}" at (${x}, ${y})`);

  const capture = await captureRegion(x, y, VERIFY_REGION_SIZE);
  const result = await verifyElementAtCenter({
    imageBase64: capture.base64,
    elementDescription
  });

  return {
    verified: result.found && result.confidence >= CONFIDENCE_THRESHOLD,
    confidence: result.confidence || 0,
    message: result.description || '',
    element_type: result.element_type
  };
}

/**
 * Search for element by zooming out and then refining coordinates
 * @returns {Promise<{found: boolean, x: number, y: number, confidence: number}>}
 */
async function searchWithZoom(startX, startY, elementDescription) {
  console.log(`[smart-click] Searching for "${elementDescription}" with zoom-out strategy`);

  for (const size of SEARCH_REGION_SIZES) {
    console.log(`[smart-click] Trying ${size}x${size} region`);

    const capture = await captureRegion(startX, startY, size);
    const result = await findElement({
      imageBase64: capture.base64,
      elementDescription,
      imageCenterX: capture.center.x,
      imageCenterY: capture.center.y
    });

    if (result.found && result.confidence >= 0.6 && result.screen_coords) {
      const newX = Math.round(result.screen_coords.x);
      const newY = Math.round(result.screen_coords.y);

      console.log(`[smart-click] Found candidate at (${newX}, ${newY}), verifying...`);

      // Verify with a tight zoom
      const verifyCapture = await captureRegion(newX, newY, VERIFY_REGION_SIZE);
      const verify = await verifyElementAtCenter({
        imageBase64: verifyCapture.base64,
        elementDescription
      });

      if (verify.found && verify.confidence >= CONFIDENCE_THRESHOLD) {
        return {
          found: true,
          x: newX,
          y: newY,
          confidence: verify.confidence,
          message: verify.description
        };
      }

      console.log(`[smart-click] Verification failed (confidence: ${verify.confidence}), continuing search`);
    }
  }

  // Try full screen as last resort
  console.log('[smart-click] Trying full screen search');
  const screenSize = await getScreenSize();
  const fullCapture = await captureRegion(
    Math.floor(screenSize.width / 2),
    Math.floor(screenSize.height / 2),
    Math.min(screenSize.width, screenSize.height)
  );

  const fullResult = await findElement({
    imageBase64: fullCapture.base64,
    elementDescription,
    imageCenterX: Math.floor(screenSize.width / 2),
    imageCenterY: Math.floor(screenSize.height / 2)
  });

  if (fullResult.found && fullResult.screen_coords) {
    return {
      found: true,
      x: Math.round(fullResult.screen_coords.x),
      y: Math.round(fullResult.screen_coords.y),
      confidence: fullResult.confidence,
      message: fullResult.description
    };
  }

  return {
    found: false,
    x: startX,
    y: startY,
    confidence: 0,
    message: 'Element not found in any search region'
  };
}

/**
 * Verify click action succeeded by comparing before/after states
 */
async function verifyClickSucceeded(x, y, beforeBase64, expectedChange) {
  // Wait for UI to update
  await new Promise(resolve => setTimeout(resolve, CLICK_DELAY_MS));

  // Capture after state
  const afterCapture = await captureRegion(x, y, POST_CLICK_REGION_SIZE);

  if (expectedChange) {
    // Use Claude to compare
    const result = await compareImages({
      beforeBase64,
      afterBase64: afterCapture.base64,
      expectedChange
    });

    return {
      success: result.expected_change_occurred,
      changed: result.changed,
      confidence: result.confidence,
      message: result.change_detected
    };
  }

  // Simple check - just report that we clicked
  return {
    success: true,
    changed: true,
    confidence: 0.5,
    message: 'Click executed (no expected_change to verify)'
  };
}

/**
 * Main smart click handler
 */
async function smartClick(input) {
  const { x, y, expected_element, expected_change, button = 'left', max_retries = MAX_RETRIES_DEFAULT } = input;

  if (x == null || y == null) {
    return { success: false, error: 'x and y coordinates are required' };
  }

  if (!expected_element) {
    return { success: false, error: 'expected_element is required - describe what should be at this location' };
  }

  let currentX = x;
  let currentY = y;
  let attempt = 0;
  const attempts = [];

  while (attempt < max_retries) {
    attempt++;
    console.log(`[smart-click] Attempt ${attempt}/${max_retries} at (${currentX}, ${currentY})`);

    const attemptLog = {
      attempt,
      target: { x: currentX, y: currentY },
      pre_verify: null,
      search: null,
      click: null,
      post_verify: null
    };

    // PHASE 1: Pre-click verification
    const preVerify = await verifyElementPresent(currentX, currentY, expected_element);
    attemptLog.pre_verify = preVerify;

    if (!preVerify.verified) {
      console.log(`[smart-click] Element not at (${currentX}, ${currentY}), searching...`);

      // PHASE 1b: Search with zoom-out
      const searchResult = await searchWithZoom(currentX, currentY, expected_element);
      attemptLog.search = searchResult;

      if (!searchResult.found) {
        attempts.push(attemptLog);
        console.log('[smart-click] Could not find element, will retry');
        continue;
      }

      // Update coordinates to found location
      currentX = searchResult.x;
      currentY = searchResult.y;
      attemptLog.target = { x: currentX, y: currentY };

      // Re-verify at new location
      const reVerify = await verifyElementPresent(currentX, currentY, expected_element);
      attemptLog.pre_verify = reVerify;

      if (!reVerify.verified) {
        attempts.push(attemptLog);
        console.log('[smart-click] Verification failed at new coordinates');
        continue;
      }
    }

    // PHASE 2: Capture before state for comparison
    const beforeCapture = await captureRegion(currentX, currentY, POST_CLICK_REGION_SIZE);

    // PHASE 3: Execute click
    console.log(`[smart-click] Clicking at (${currentX}, ${currentY})`);
    const clickResult = await executeClick(currentX, currentY, button);
    attemptLog.click = clickResult;

    // PHASE 4: Verify click succeeded
    const postVerify = await verifyClickSucceeded(
      currentX,
      currentY,
      beforeCapture.base64,
      expected_change
    );
    attemptLog.post_verify = postVerify;
    attempts.push(attemptLog);

    if (postVerify.success) {
      return {
        success: true,
        clicked_at: { x: currentX, y: currentY },
        original_target: { x, y },
        coordinates_adjusted: (currentX !== x || currentY !== y),
        attempts: attempt,
        verification: {
          pre_click_confidence: attemptLog.pre_verify.confidence,
          post_click: postVerify
        },
        attempt_log: attempts
      };
    }

    console.log(`[smart-click] Post-click verification failed: ${postVerify.message}`);
  }

  // All retries exhausted
  return {
    success: false,
    error: `Failed to click "${expected_element}" after ${max_retries} attempts`,
    original_target: { x, y },
    last_target: { x: currentX, y: currentY },
    attempts: max_retries,
    attempt_log: attempts
  };
}

const definitions = [
  {
    name: 'desktop_smart_click',
    description: 'Click with visual verification. Captures region around target, verifies element is present using Claude vision, clicks, then verifies action succeeded. Automatically searches for element if not at expected coordinates. Use this instead of blind desktop_mouse clicks for reliable UI automation.',
    input_schema: {
      type: 'object',
      properties: {
        x: {
          type: 'number',
          description: 'Target X coordinate (screen pixels)'
        },
        y: {
          type: 'number',
          description: 'Target Y coordinate (screen pixels)'
        },
        expected_element: {
          type: 'string',
          description: 'What element should be at this location (e.g., "Submit button", "File menu", "Close icon", "Search input field")'
        },
        expected_change: {
          type: 'string',
          description: 'What should visually change after clicking (e.g., "menu opens", "dialog closes", "button appears pressed"). If omitted, click is executed without post-click verification.'
        },
        button: {
          type: 'string',
          enum: ['left', 'right'],
          description: 'Mouse button to click (default: left)'
        },
        max_retries: {
          type: 'integer',
          description: 'Maximum retry attempts if verification fails (default: 3)'
        }
      },
      required: ['x', 'y', 'expected_element']
    }
  }
];

const handlers = {
  desktop_smart_click: smartClick
};

module.exports = { definitions, handlers };
