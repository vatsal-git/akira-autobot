/**
 * Desktop Smart Click Tool
 * Click with visual verification - captures region around target, verifies element,
 * clicks, then verifies action succeeded. Includes retry logic with zoom-out search.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runPowerShell, getScreenSize } = require('../utils/powershell');
const { captureCenteredRegion } = require('../utils/screenshot');
const { analyzeImage, compareImages, findElement, verifyElementAtCenter, locateElementInImage, verifyCursorOnElement } = require('../utils/bedrock-vision');

// Constants
const SEARCH_REGION_SIZES = [500, 800, 1200];  // Expanding search sizes
const POST_CLICK_REGION_SIZE = 400;  // Post-click verification region
const CONFIDENCE_THRESHOLD = 0.75;   // Minimum confidence to proceed

// Confidence-based verify region scaling
// Higher confidence from locate → larger (faster) verify region
const VERIFY_REGION_SCALING = {
  thresholds: [0.95, 0.85, 0.75],    // Confidence thresholds (checked in order)
  sizes: [600, 400, 200, 200]        // Region sizes: ≥0.95→600, ≥0.85→400, ≥0.75→200, <0.75→200
};
const VERIFY_REGION_SIZE_DEFAULT = 200;  // Fallback for direct verification calls
const CLICK_DELAY_MS = 300;          // Wait after click for UI to update
const MAX_RETRIES_DEFAULT = 3;

// Debug mode - saves screenshots to a folder for inspection
const DEBUG_MODE = true;
const DEBUG_FOLDER = path.join(os.tmpdir(), 'smart_click_debug');

function ensureDebugFolder() {
  if (DEBUG_MODE && !fs.existsSync(DEBUG_FOLDER)) {
    fs.mkdirSync(DEBUG_FOLDER, { recursive: true });
    console.log(`[smart-click] Debug folder: ${DEBUG_FOLDER}`);
  }
}

function saveDebugImage(base64, label) {
  if (!DEBUG_MODE) return null;
  ensureDebugFolder();
  const filename = `${Date.now()}_${label}.png`;
  const filepath = path.join(DEBUG_FOLDER, filename);
  fs.writeFileSync(filepath, Buffer.from(base64, 'base64'));
  console.log(`[smart-click] DEBUG saved: ${filepath}`);
  return filepath;
}

/**
 * Get verify region size based on locate confidence
 * Higher confidence → larger region (faster verification)
 * Lower confidence → smaller region (more precise verification)
 * @param {number} confidence - Confidence from locate step (0-1)
 * @returns {number} Region size in pixels
 */
function getVerifyRegionSize(confidence) {
  const { thresholds, sizes } = VERIFY_REGION_SCALING;
  for (let i = 0; i < thresholds.length; i++) {
    if (confidence >= thresholds[i]) {
      console.log(`[smart-click] Confidence ${confidence.toFixed(2)} ≥ ${thresholds[i]} → verify region ${sizes[i]}px`);
      return sizes[i];
    }
  }
  console.log(`[smart-click] Confidence ${confidence.toFixed(2)} < ${thresholds[thresholds.length - 1]} → verify region ${sizes[sizes.length - 1]}px (precise)`);
  return sizes[sizes.length - 1];
}

/**
 * Wrapper around centralized screenshot utility for smart click
 * @param {number} centerX - Center X coordinate
 * @param {number} centerY - Center Y coordinate
 * @param {number} size - Region size (width = height = size)
 * @param {boolean} drawCrosshair - Whether to draw a crosshair at target position
 * @param {string} [label] - Label for overlay display
 * @param {boolean} [animate] - Whether to animate the overlay
 * @returns {Promise<{base64: string, region: Object}>}
 */
async function captureRegion(centerX, centerY, size, drawCrosshair = true, label = null, animate = false) {
  return captureCenteredRegion(centerX, centerY, size, {
    drawCrosshair,
    label,
    animate,
    showOverlay: true
  });
}

/**
 * Move cursor to coordinates (without clicking)
 */
async function moveCursor(x, y) {
  const moveScript = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
    Start-Sleep -Milliseconds 50
  `;
  await runPowerShell(moveScript);
  return { x, y };
}

/**
 * Execute a mouse click at coordinates
 */
async function executeClick(x, y, button = 'left') {
  await moveCursor(x, y);

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
 * @param {number} x - X coordinate
 * @param {number} y - Y coordinate
 * @param {string} elementDescription - Description of expected element
 * @param {number} [regionSize] - Verify region size (defaults to VERIFY_REGION_SIZE_DEFAULT)
 * @returns {Promise<{verified: boolean, confidence: number, message: string}>}
 */
async function verifyElementPresent(x, y, elementDescription, regionSize = VERIFY_REGION_SIZE_DEFAULT) {
  console.log(`[smart-click] Verifying "${elementDescription}" at (${x}, ${y}) with ${regionSize}px region`);

  const capture = await captureRegion(x, y, regionSize, true, 'Verifying...');
  saveDebugImage(capture.base64, `verify_${regionSize}px_${x}_${y}`);

  const result = await verifyElementAtCenter({
    imageBase64: capture.base64,
    elementDescription
  });

  // Log full Claude response for debugging
  console.log(`[smart-click] Claude response: found=${result.found}, confidence=${result.confidence}, desc="${result.description}"`);

  return {
    verified: result.found && result.confidence >= CONFIDENCE_THRESHOLD,
    confidence: result.confidence || 0,
    message: result.description || '',
    element_type: result.element_type,
    found: result.found  // expose the raw found value
  };
}

/**
 * Locate element in image (can be anywhere, not just center)
 * @returns {Promise<{found: boolean, x: number, y: number, confidence: number, offset: {x, y}}>}
 */
async function locateElementInRegion(centerX, centerY, size, elementDescription, animate = true) {
  const capture = await captureRegion(centerX, centerY, size, false, 'Searching...', animate);
  saveDebugImage(capture.base64, `locate_${size}_at_${centerX}_${centerY}`);

  const result = await locateElementInImage({
    imageBase64: capture.base64,
    elementDescription,
    imageWidth: capture.region.width,
    imageHeight: capture.region.height
  });

  console.log(`[smart-click] Locate result: found=${result.found}, confidence=${result.confidence}, offset=${JSON.stringify(result.suggested_coords)}`);

  if (result.found && result.suggested_coords) {
    // Convert image offset to screen coordinates
    const screenX = capture.center.x + (result.suggested_coords.x || 0);
    const screenY = capture.center.y + (result.suggested_coords.y || 0);

    return {
      found: true,
      x: Math.round(screenX),
      y: Math.round(screenY),
      confidence: result.confidence,
      message: result.description
    };
  }

  return {
    found: false,
    x: centerX,
    y: centerY,
    confidence: result.confidence || 0,
    message: result.description || 'Element not found'
  };
}

/**
 * Iterative locate-move-verify approach
 * 1. Take screenshot, find element anywhere in image
 * 2. Move cursor to found coordinates
 * 3. Take new screenshot, verify cursor is on element
 * 4. If not on element, get adjustment and repeat
 * @returns {Promise<{found: boolean, x: number, y: number, confidence: number}>}
 */
async function locateAndMoveToElement(startX, startY, elementDescription, maxAdjustments = 3) {
  console.log(`[smart-click] Locating "${elementDescription}" with iterative approach`);

  let currentX = startX;
  let currentY = startY;

  // Try progressively larger search regions
  for (const size of SEARCH_REGION_SIZES) {
    console.log(`[smart-click] Searching in ${size}x${size} region around (${currentX}, ${currentY})`);

    // Step 1: Locate element in the region
    const locateResult = await locateElementInRegion(currentX, currentY, size, elementDescription);

    if (!locateResult.found) {
      console.log(`[smart-click] Element not found in ${size}x${size} region`);
      continue;
    }

    console.log(`[smart-click] Element located at (${locateResult.x}, ${locateResult.y}) with confidence ${locateResult.confidence}`);

    // Step 2: Determine verify region size based on locate confidence
    const verifySize = getVerifyRegionSize(locateResult.confidence);

    // Step 3: Move cursor to found location and iteratively refine
    let targetX = locateResult.x;
    let targetY = locateResult.y;

    for (let adjustment = 0; adjustment < maxAdjustments; adjustment++) {
      console.log(`[smart-click] Moving cursor to (${targetX}, ${targetY}), adjustment ${adjustment + 1}/${maxAdjustments}`);
      await moveCursor(targetX, targetY);

      // Step 4: Take screenshot with confidence-based region size and verify cursor is on element
      const verifyCapture = await captureRegion(targetX, targetY, verifySize, true, 'Verifying...');
      saveDebugImage(verifyCapture.base64, `verify_${verifySize}px_cursor_${adjustment}_${targetX}_${targetY}`);

      // Crosshair is drawn on the image - Claude will look for it
      const verify = await verifyCursorOnElement({
        imageBase64: verifyCapture.base64,
        elementDescription
      });

      console.log(`[smart-click] Crosshair at: (${verifyCapture.targetInImage.x}, ${verifyCapture.targetInImage.y}) in image`);
      console.log(`[smart-click] Verify result: found=${verify.found}, confidence=${verify.confidence}, adjustment=${JSON.stringify(verify.suggested_coords)}`);

      if (verify.found && verify.confidence >= CONFIDENCE_THRESHOLD) {
        console.log(`[smart-click] Cursor confirmed on element at (${targetX}, ${targetY})`);
        return {
          found: true,
          x: targetX,
          y: targetY,
          confidence: verify.confidence,
          message: verify.description
        };
      }

      // Step 4: If not on element, apply adjustment offset
      if (verify.suggested_coords && (verify.suggested_coords.x !== 0 || verify.suggested_coords.y !== 0)) {
        const oldX = targetX;
        const oldY = targetY;
        targetX = Math.round(targetX + (verify.suggested_coords.x || 0));
        targetY = Math.round(targetY + (verify.suggested_coords.y || 0));
        console.log(`[smart-click] Adjusting from (${oldX}, ${oldY}) to (${targetX}, ${targetY})`);
      } else {
        // No adjustment suggested, break out of adjustment loop
        console.log(`[smart-click] No adjustment suggested, trying next region size`);
        break;
      }
    }
  }

  // Try full screen as last resort
  console.log('[smart-click] Trying full screen search');
  const screenSize = await getScreenSize();
  const fullResult = await locateElementInRegion(
    Math.floor(screenSize.width / 2),
    Math.floor(screenSize.height / 2),
    Math.min(screenSize.width, screenSize.height),
    elementDescription
  );

  if (fullResult.found) {
    // Move to found location and do one verification with confidence-based region size
    const fullScreenVerifySize = getVerifyRegionSize(fullResult.confidence);
    await moveCursor(fullResult.x, fullResult.y);
    const verifyCapture = await captureRegion(fullResult.x, fullResult.y, fullScreenVerifySize, true, 'Verifying...');
    saveDebugImage(verifyCapture.base64, `verify_${fullScreenVerifySize}px_fullscreen_${fullResult.x}_${fullResult.y}`);

    const verify = await verifyCursorOnElement({
      imageBase64: verifyCapture.base64,
      elementDescription
    });

    if (verify.found) {
      return {
        found: true,
        x: fullResult.x,
        y: fullResult.y,
        confidence: verify.confidence,
        message: verify.description
      };
    }
  }

  return {
    found: false,
    x: startX,
    y: startY,
    confidence: 0,
    message: 'Element not found after all search attempts'
  };
}

/**
 * Verify click action succeeded by comparing before/after states
 */
async function verifyClickSucceeded(x, y, beforeBase64, expectedChange) {
  // Wait for UI to update
  await new Promise(resolve => setTimeout(resolve, CLICK_DELAY_MS));

  // Capture after state
  const afterCapture = await captureRegion(x, y, POST_CLICK_REGION_SIZE, false, 'Checking...');

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

  // Announce debug folder at start
  if (DEBUG_MODE) {
    ensureDebugFolder();
    console.log(`[smart-click] DEBUG MODE ON - screenshots saved to: ${DEBUG_FOLDER}`);
  }

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
    console.log(`[smart-click] Attempt ${attempt}/${max_retries} starting from (${currentX}, ${currentY})`);

    const attemptLog = {
      attempt,
      original_target: { x: currentX, y: currentY },
      locate: null,
      click: null,
      post_verify: null
    };

    // PHASE 1: Locate element and move cursor to it (iterative approach)
    const locateResult = await locateAndMoveToElement(currentX, currentY, expected_element);
    attemptLog.locate = locateResult;

    if (!locateResult.found) {
      attempts.push(attemptLog);
      console.log('[smart-click] Could not locate element, will retry');
      continue;
    }

    // Update coordinates to found location
    currentX = locateResult.x;
    currentY = locateResult.y;
    attemptLog.final_target = { x: currentX, y: currentY };

    // PHASE 2: Capture before state for comparison
    const beforeCapture = await captureRegion(currentX, currentY, POST_CLICK_REGION_SIZE, false, 'Ready to click', false);

    // PHASE 3: Execute click (cursor is already positioned)
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
          locate_confidence: locateResult.confidence,
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
