/**
 * Centralized Screenshot Utility
 * Captures screen regions and emits overlay events for visual feedback
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runPowerShell, getScreenSize } = require('./powershell');
const { emitScreenshot } = require('../../overlay/overlay-events');

/**
 * Capture a screen region with optional overlay feedback
 * @param {Object} region - Region to capture { left, top, width, height }
 * @param {Object} [options] - Options
 * @param {string} [options.label] - Label for overlay (e.g., "Searching...", "Verifying...")
 * @param {boolean} [options.animate] - Whether to animate the overlay (for expanding regions)
 * @param {boolean} [options.showOverlay=true] - Whether to show overlay feedback
 * @param {boolean} [options.drawCrosshair=false] - Draw crosshair at center (for vision verification)
 * @param {number} [options.crosshairX] - X position for crosshair (relative to region, defaults to center)
 * @param {number} [options.crosshairY] - Y position for crosshair (relative to region, defaults to center)
 * @returns {Promise<{base64: string, region: Object, center: Object}>}
 */
async function captureScreenRegion(region, options = {}) {
  const {
    label = null,
    animate = false,
    showOverlay = true,
    drawCrosshair = false,
    crosshairX = null,
    crosshairY = null
  } = options;

  const { left, top, width, height } = region;
  const tempFile = path.join(os.tmpdir(), `akira_screenshot_${Date.now()}.png`);

  // Emit overlay event before capture (so user sees it while screenshot is being taken)
  if (showOverlay) {
    emitScreenshot(region, label, animate);
  }

  // Calculate crosshair position (default to center)
  const targetX = crosshairX !== null ? crosshairX : Math.floor(width / 2);
  const targetY = crosshairY !== null ? crosshairY : Math.floor(height / 2);

  // Crosshair drawing code (only if enabled)
  const crosshairCode = drawCrosshair ? `
    # Draw crosshair at target position
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::Red, 2)
    $crossSize = 15
    $tx = ${targetX}
    $ty = ${targetY}

    # Horizontal line
    $graphics.DrawLine($pen, [Math]::Max(0, $tx - $crossSize), $ty, [Math]::Min(${width}, $tx + $crossSize), $ty)
    # Vertical line
    $graphics.DrawLine($pen, $tx, [Math]::Max(0, $ty - $crossSize), $tx, [Math]::Min(${height}, $ty + $crossSize))

    # Small circle at center
    $pen2 = New-Object System.Drawing.Pen([System.Drawing.Color]::Red, 1)
    $graphics.DrawEllipse($pen2, $tx - 3, $ty - 3, 6, 6)

    $pen.Dispose()
    $pen2.Dispose()
` : '';

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
    $bitmap = New-Object System.Drawing.Bitmap(${width}, ${height})
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen(${left}, ${top}, 0, 0, (New-Object System.Drawing.Size(${width}, ${height})))
    ${crosshairCode}
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
    },
    targetInImage: { x: targetX, y: targetY },
    targetScreen: { x: left + targetX, y: top + targetY }
  };
}

/**
 * Capture full screen with optional overlay feedback
 * @param {Object} [options] - Options
 * @param {string} [options.label] - Label for overlay
 * @param {boolean} [options.showOverlay=true] - Whether to show overlay feedback
 * @returns {Promise<{base64: string, width: number, height: number}>}
 */
async function captureFullScreen(options = {}) {
  const { label = null, showOverlay = true } = options;

  const screenSize = await getScreenSize();
  const tempFile = path.join(os.tmpdir(), `akira_screenshot_${Date.now()}.png`);

  // Emit fullscreen overlay event
  if (showOverlay) {
    emitScreenshot(null, label, false);
  }

  // Method 1: Standard PowerShell with System.Drawing
  try {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
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

    if (fs.existsSync(tempFile)) {
      const imageBuffer = fs.readFileSync(tempFile);
      const base64 = imageBuffer.toString('base64');
      fs.unlinkSync(tempFile);

      return {
        base64,
        width: screenSize.width,
        height: screenSize.height,
        method: 'powershell_drawing'
      };
    }
  } catch (error) {
    console.warn('[screenshot] PowerShell screenshot failed:', error.message);
  }

  // Method 2: BitBlt via PowerShell (more reliable for some systems)
  try {
    const captureScript = `
Add-Type @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

public class ScreenCapture {
    [DllImport("user32.dll")]
    static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")]
    static extern IntPtr GetWindowDC(IntPtr hWnd);
    [DllImport("gdi32.dll")]
    static extern bool BitBlt(IntPtr hdcDest, int xDest, int yDest, int wDest, int hDest, IntPtr hdcSrc, int xSrc, int ySrc, int rop);
    [DllImport("user32.dll")]
    static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("user32.dll")]
    static extern int GetSystemMetrics(int nIndex);

    public static void CaptureScreen(string path) {
        int width = GetSystemMetrics(0);
        int height = GetSystemMetrics(1);

        if (width <= 0 || height <= 0) {
            throw new Exception("Could not get screen dimensions");
        }

        IntPtr desktop = GetDesktopWindow();
        IntPtr hdc = GetWindowDC(desktop);

        using (Bitmap bmp = new Bitmap(width, height, PixelFormat.Format32bppArgb)) {
            using (Graphics g = Graphics.FromImage(bmp)) {
                IntPtr hdcDest = g.GetHdc();
                BitBlt(hdcDest, 0, 0, width, height, hdc, 0, 0, 0x00CC0020);
                g.ReleaseHdc(hdcDest);
            }
            bmp.Save(path, ImageFormat.Png);
        }

        ReleaseDC(desktop, hdc);
    }
}
"@
[ScreenCapture]::CaptureScreen("${tempFile}")
Write-Output "OK"
`;

    await runPowerShell(captureScript, { timeout: 20000 });

    if (fs.existsSync(tempFile)) {
      const imageBuffer = fs.readFileSync(tempFile);
      const base64 = imageBuffer.toString('base64');
      fs.unlinkSync(tempFile);

      return {
        base64,
        width: screenSize.width,
        height: screenSize.height,
        method: 'powershell_bitblt'
      };
    }
  } catch (error) {
    console.warn('[screenshot] BitBlt screenshot failed:', error.message);
  }

  // All methods failed
  throw new Error('Screenshot capture failed. Ensure the app is running in an interactive desktop session with screen capture permissions.');
}

/**
 * Capture a region centered on given coordinates
 * @param {number} centerX - Center X coordinate
 * @param {number} centerY - Center Y coordinate
 * @param {number} size - Region size (width = height = size)
 * @param {Object} [options] - Options (same as captureScreenRegion)
 * @returns {Promise<Object>}
 */
async function captureCenteredRegion(centerX, centerY, size, options = {}) {
  const screenSize = await getScreenSize();
  const half = Math.floor(size / 2);

  // Calculate region bounds, clamping to screen
  const left = Math.max(0, Math.min(centerX - half, screenSize.width - size));
  const top = Math.max(0, Math.min(centerY - half, screenSize.height - size));
  const width = Math.min(size, screenSize.width - left);
  const height = Math.min(size, screenSize.height - top);

  // Calculate where the original target point is within this image
  const targetX = centerX - left;
  const targetY = centerY - top;

  return captureScreenRegion(
    { left, top, width, height },
    {
      ...options,
      crosshairX: options.drawCrosshair ? targetX : null,
      crosshairY: options.drawCrosshair ? targetY : null
    }
  );
}

module.exports = {
  captureScreenRegion,
  captureFullScreen,
  captureCenteredRegion
};
