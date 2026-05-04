/**
 * Desktop Screen Query Tool
 * desktop_screen_query - Get mouse position, screen size, or take a screenshot
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runPowerShell, getScreenSize, getMousePosition } = require('../utils/powershell');
const { emitScreenshot } = require('../../overlay/overlay-events');

/**
 * Take screenshot using PowerShell with multiple fallback methods
 */
async function takeScreenshot(region = null) {
  const tempFile = path.join(os.tmpdir(), `akira_screenshot_${Date.now()}.png`);

  // Get screen size upfront for full-screen screenshots
  let screenDimensions = null;
  if (!region) {
    screenDimensions = await getScreenSize();
  }

  // Method 1: PowerShell with System.Drawing
  try {
    let script;
    if (region) {
      script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
    $left = ${region.left}
    $top = ${region.top}
    $width = ${region.width}
    $height = ${region.height}
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
    $bitmap.Save("${tempFile}")
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Output "OK"
} catch {
    Write-Host "EXCEPTION: $($_.Exception.Message)"
    exit 1
}
`;
    } else {
      script = `
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
    }

    const { stdout, stderr } = await runPowerShell(script, { timeout: 15000 });

    if (fs.existsSync(tempFile)) {
      const imageBuffer = fs.readFileSync(tempFile);
      const base64 = imageBuffer.toString('base64');
      fs.unlinkSync(tempFile);

      return {
        format: 'png',
        base64,
        width: region ? region.width : screenDimensions?.width,
        height: region ? region.height : screenDimensions?.height,
        method: 'powershell_drawing'
      };
    }

    console.warn('[desktop-tools] PowerShell screenshot did not create file:', stdout, stderr);
  } catch (error) {
    console.warn('[desktop-tools] PowerShell screenshot failed:', error.message);
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
        format: 'png',
        base64,
        width: region ? region.width : screenDimensions?.width,
        height: region ? region.height : screenDimensions?.height,
        method: 'powershell_bitblt'
      };
    }
  } catch (error) {
    console.warn('[desktop-tools] BitBlt screenshot failed:', error.message);
  }

  // Method 3: Simple fallback
  try {
    const simpleScript = `
[Reflection.Assembly]::LoadWithPartialName("System.Drawing") | Out-Null
[Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bmp.Save("${tempFile}")
$g.Dispose()
$bmp.Dispose()
`;

    await runPowerShell(simpleScript, { timeout: 15000 });

    if (fs.existsSync(tempFile)) {
      const imageBuffer = fs.readFileSync(tempFile);
      const base64 = imageBuffer.toString('base64');
      fs.unlinkSync(tempFile);

      return {
        format: 'png',
        base64,
        width: region ? region.width : screenDimensions?.width,
        height: region ? region.height : screenDimensions?.height,
        method: 'powershell_simple'
      };
    }
  } catch (error) {
    console.warn('[desktop-tools] Simple PowerShell screenshot failed:', error.message);
  }

  // All methods failed - return detailed error
  const screenSize = await getScreenSize();
  return {
    error: 'Screenshot capture failed. This may be due to: (1) Running without GUI access, (2) Screen capture permissions blocked, (3) Remote desktop session limitations.',
    screenSize,
    suggestions: [
      'Ensure the app is running in an interactive desktop session',
      'Check Windows privacy settings for screen capture',
      'Try running the app as administrator'
    ]
  };
}

const definitions = [
  {
    name: 'desktop_screen_query',
    description: 'Get mouse position, screen size, or take a screenshot. Screenshot returns base64 PNG.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get_mouse_position', 'get_screen_size', 'screenshot'],
          description: 'Query operation',
        },
        region: {
          type: 'object',
          properties: {
            left: { type: 'number' },
            top: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          description: 'Optional region for screenshot',
        },
      },
      required: ['action'],
    },
  },
];

const handlers = {
  async desktop_screen_query(input) {
    const action = input.action;

    switch (action) {
      case 'get_mouse_position':
        return await getMousePosition();

      case 'get_screen_size':
        return await getScreenSize();

      case 'screenshot':
        emitScreenshot(input.region || null, 'Screenshot');
        return await takeScreenshot(input.region);

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },
};

module.exports = { definitions, handlers };
