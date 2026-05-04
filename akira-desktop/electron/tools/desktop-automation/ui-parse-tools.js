/**
 * UI Parse Tools
 * desktop_ui_parse - OCR-based UI element detection using Tesseract.js
 * Upgraded to use spawn() for better control
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Tesseract = require('tesseract.js');

// Tesseract.js worker instance (reused for performance)
let tesseractWorker = null;

const IS_WINDOWS = process.platform === 'win32';

/**
 * Execute a command using spawn with timeout and buffer limits
 */
function spawnCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = 60000, maxBuffer = 10 * 1024 * 1024, cwd } = options;

    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timeoutId = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 1000);
    }, timeout);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
      if (stdout.length > maxBuffer) {
        killed = true;
        child.kill('SIGTERM');
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);

      if (killed) {
        reject(Object.assign(new Error('Command timed out or exceeded buffer'), { stdout, stderr }));
      } else if (code !== 0) {
        reject(Object.assign(new Error(`Command failed with code ${code}`), { code, stdout, stderr }));
      } else {
        resolve({ stdout, stderr });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(Object.assign(err, { stdout, stderr }));
    });
  });
}

// Session store for parsed elements (mimics backend's screen_parse_session.py)
const sessions = new Map();
const SESSION_TTL = 15 * 60 * 1000; // 15 minutes
const MAX_SESSIONS = 50;

/**
 * Generate unique session ID
 */
function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 12);
}

/**
 * Store parse session
 */
function storeSession(elements, metadata = {}) {
  // Clean expired sessions
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(id);
    }
  }

  // Evict oldest if at capacity
  while (sessions.size >= MAX_SESSIONS) {
    const oldestKey = sessions.keys().next().value;
    sessions.delete(oldestKey);
  }

  const sessionId = generateSessionId();
  sessions.set(sessionId, {
    elements,
    metadata,
    expiresAt: now + SESSION_TTL,
  });

  return sessionId;
}

/**
 * Get session by ID
 */
function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }

  return session;
}

/**
 * Execute PowerShell command using spawn() by writing to a temp .ps1 file
 */
async function runPowerShell(script, options = {}) {
  if (!IS_WINDOWS) {
    throw new Error('UI parsing is only available on Windows');
  }

  const timeout = options.timeout || 30000;
  const scriptFile = path.join(os.tmpdir(), `ps_script_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);

  try {
    fs.writeFileSync(scriptFile, script, 'utf8');

    // Execute with STA mode for WinRT compatibility
    const { stdout, stderr } = await spawnCommand(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', scriptFile],
      { timeout }
    );

    if (stderr && stderr.trim()) {
      console.warn('[ui-parse-tools] PowerShell stderr:', stderr.trim());
    }

    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    console.error('[ui-parse-tools] PowerShell error:', error.message);
    if (error.stdout) {
      console.error('[ui-parse-tools] PowerShell stdout:', error.stdout);
    }
    if (error.stderr) {
      console.error('[ui-parse-tools] PowerShell stderr:', error.stderr);
    }
    const fullError = [
      error.message,
      error.stdout ? `stdout: ${error.stdout}` : '',
      error.stderr ? `stderr: ${error.stderr}` : ''
    ].filter(Boolean).join(' | ');
    throw new Error(`PowerShell failed: ${fullError}`);
  } finally {
    try {
      if (fs.existsSync(scriptFile)) fs.unlinkSync(scriptFile);
    } catch {}
  }
}

/**
 * Take screenshot and save to temp file with multiple fallback methods
 */
async function captureScreenshot(region = null) {
  const tempFile = path.join(os.tmpdir(), `akira_ocr_${Date.now()}.png`);

  // Method 1: Standard PowerShell with System.Drawing
  try {
    let script;
    if (region) {
      script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

try {
    $bitmap = New-Object System.Drawing.Bitmap(${region.width}, ${region.height})
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen(${region.left}, ${region.top}, 0, 0, (New-Object System.Drawing.Size(${region.width}, ${region.height})))
    $bitmap.Save("${tempFile}")
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Output "${region.width},${region.height}"
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
    Write-Output "$($screen.Bounds.Width),$($screen.Bounds.Height)"
} catch {
    Write-Host "EXCEPTION: $($_.Exception.Message)"
    exit 1
}
`;
    }

    const { stdout, stderr } = await runPowerShell(script, { timeout: 30000 });

    if (fs.existsSync(tempFile)) {
      let captureWidth, captureHeight;
      if (region) {
        captureWidth = region.width;
        captureHeight = region.height;
      } else {
        const parts = stdout.trim().split(',');
        captureWidth = parseInt(parts[0]) || 1920;
        captureHeight = parseInt(parts[1]) || 1080;
      }
      return { tempFile, captureWidth, captureHeight, method: 'powershell_drawing' };
    }

    console.warn('[ui-parse-tools] PowerShell screenshot did not create file:', stdout, stderr);
  } catch (error) {
    console.warn('[ui-parse-tools] PowerShell screenshot failed:', error.message);
  }

  // Method 2: BitBlt via PowerShell (more reliable for some systems)
  try {
    const bitbltScript = `
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

    public static string CaptureScreen(string path) {
        int width = GetSystemMetrics(0);
        int height = GetSystemMetrics(1);

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
        return width + "," + height;
    }
}
"@
$result = [ScreenCapture]::CaptureScreen("${tempFile}")
Write-Output $result
`;

    const { stdout } = await runPowerShell(bitbltScript, { timeout: 30000 });

    if (fs.existsSync(tempFile)) {
      const parts = stdout.trim().split(',');
      const captureWidth = region ? region.width : (parseInt(parts[0]) || 1920);
      const captureHeight = region ? region.height : (parseInt(parts[1]) || 1080);
      return { tempFile, captureWidth, captureHeight, method: 'powershell_bitblt' };
    }
  } catch (error) {
    console.warn('[ui-parse-tools] BitBlt screenshot failed:', error.message);
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
Write-Output "$($bounds.Width),$($bounds.Height)"
`;

    const { stdout } = await runPowerShell(simpleScript, { timeout: 30000 });

    if (fs.existsSync(tempFile)) {
      const parts = stdout.trim().split(',');
      const captureWidth = region ? region.width : (parseInt(parts[0]) || 1920);
      const captureHeight = region ? region.height : (parseInt(parts[1]) || 1080);
      return { tempFile, captureWidth, captureHeight, method: 'powershell_simple' };
    }
  } catch (error) {
    console.warn('[ui-parse-tools] Simple PowerShell screenshot failed:', error.message);
  }

  // All methods failed
  throw new Error('Screenshot capture failed. Ensure the app is running in an interactive desktop session with screen capture permissions.');
}

/**
 * Run OCR using Tesseract via PowerShell
 * Note: Requires Tesseract OCR to be installed on Windows
 * Alternative: Use Windows built-in OCR via UWP APIs
 */
async function runOCR(imagePath, maxElements = 80, minConfidence = 25) {
  const errors = [];

  // Try Tesseract.js first (pure JavaScript, no dependencies)
  try {
    console.log('[ui-parse-tools] Attempting Tesseract.js OCR...');
    const result = await runTesseractJS(imagePath, maxElements, minConfidence);
    if (result.elements && result.elements.length >= 0) {
      return result;
    }
  } catch (e) {
    console.error('[ui-parse-tools] Tesseract.js OCR failed:', e.message);
    errors.push(`Tesseract.js: ${e.message}`);
  }

  // Fallback to native Tesseract binary if installed
  try {
    console.log('[ui-parse-tools] Attempting Tesseract binary fallback...');
    const result = await runTesseractOCR(imagePath, maxElements, minConfidence);
    if (result.elements && result.elements.length >= 0) {
      return result;
    }
  } catch (e) {
    console.error('[ui-parse-tools] Tesseract binary failed:', e.message);
    errors.push(`Tesseract binary: ${e.message}`);
  }

  const errorSummary = errors.join('; ');
  console.error('[ui-parse-tools] All OCR methods failed:', errorSummary);
  return {
    elements: [],
    parser: 'none',
    error: `OCR failed. ${errorSummary}`
  };
}

/**
 * Run Tesseract.js OCR (pure JavaScript, no external dependencies)
 */
async function runTesseractJS(imagePath, maxElements = 80, minConfidence = 25) {
  console.log('[ui-parse-tools] Running Tesseract.js on:', imagePath);

  // Initialize worker if not exists
  if (!tesseractWorker) {
    console.log('[ui-parse-tools] Creating Tesseract.js worker...');
    tesseractWorker = await Tesseract.createWorker('eng', 1, {
      logger: m => {
        if (m.status === 'recognizing text') {
          console.log(`[ui-parse-tools] OCR progress: ${Math.round(m.progress * 100)}%`);
        }
      }
    });
  }

  // Run OCR
  const { data } = await tesseractWorker.recognize(imagePath);

  // Convert words to elements
  const elements = [];
  for (const word of data.words) {
    if (elements.length >= maxElements) break;

    const confidence = word.confidence;
    if (confidence < minConfidence) continue;

    const text = word.text.trim();
    if (!text) continue;

    const bbox = word.bbox;
    elements.push({
      id: elements.length,
      type: 'text',
      label: text,
      interactivity: text.length <= 40,
      confidence: confidence / 100,
      bbox: {
        left: bbox.x0,
        top: bbox.y0,
        right: bbox.x1,
        bottom: bbox.y1,
        width: bbox.x1 - bbox.x0,
        height: bbox.y1 - bbox.y0,
      },
      center: {
        x: Math.floor((bbox.x0 + bbox.x1) / 2),
        y: Math.floor((bbox.y0 + bbox.y1) / 2),
      },
    });
  }

  console.log(`[ui-parse-tools] Tesseract.js found ${elements.length} elements`);
  return { elements, parser: 'tesseract.js' };
}

/**
 * Run Windows built-in OCR (Windows 10+)
 * Uses compiled C# for reliable WinRT async handling
 */
async function runWindowsOCR(imagePath, maxElements = 80, minConfidence = 25) {
  // Use forward slashes and escape for C# string
  const normalizedPath = imagePath.replace(/\\/g, '/');

  // Compile C# code that properly handles WinRT async
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Compile C# OCR helper
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Windows.Storage;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;

public class OcrHelper
{
    public static string RunOcr(string imagePath, int maxElements)
    {
        try
        {
            var task = RunOcrAsync(imagePath, maxElements);
            return task.GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            return "{\\"error\\": \\"" + ex.Message.Replace("\\\\", "\\\\\\\\").Replace("\\"", "'") + "\\"}";
        }
    }

    private static async Task<string> RunOcrAsync(string imagePath, int maxElements)
    {
        // Load image file
        var file = await StorageFile.GetFileFromPathAsync(imagePath);
        using (var stream = await file.OpenAsync(FileAccessMode.Read))
        {
            // Decode bitmap
            var decoder = await BitmapDecoder.CreateAsync(stream);
            var bitmap = await decoder.GetSoftwareBitmapAsync();

            // Get OCR engine
            var ocrEngine = OcrEngine.TryCreateFromUserProfileLanguages();
            if (ocrEngine == null)
            {
                ocrEngine = OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language("en-US"));
            }
            if (ocrEngine == null)
            {
                return "{\\"error\\": \\"No OCR engine available. Install English language pack.\\"}";
            }

            // Run OCR
            var result = await ocrEngine.RecognizeAsync(bitmap);

            // Build JSON output
            var items = new List<string>();
            int id = 0;
            foreach (var line in result.Lines)
            {
                foreach (var word in line.Words)
                {
                    var rect = word.BoundingRect;
                    items.Add(string.Format(
                        "{{\\"id\\":{0},\\"text\\":\\"{1}\\",\\"left\\":{2},\\"top\\":{3},\\"width\\":{4},\\"height\\":{5}}}",
                        id,
                        word.Text.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\""),
                        (int)rect.X,
                        (int)rect.Y,
                        (int)rect.Width,
                        (int)rect.Height
                    ));
                    id++;
                    if (id >= maxElements) break;
                }
                if (id >= maxElements) break;
            }

            return "[" + string.Join(",", items) + "]";
        }
    }
}
'@ -ReferencedAssemblies @(
    'System.Runtime.WindowsRuntime',
    [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime].Assembly.Location,
    [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime].Assembly.Location,
    [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime].Assembly.Location
)

# Verify image exists
$imgPath = "${normalizedPath}"
if (-not (Test-Path $imgPath)) {
    Write-Output '{"error": "Image not found"}'
    exit 0
}

$fullPath = (Resolve-Path $imgPath).Path
$result = [OcrHelper]::RunOcr($fullPath, ${maxElements})
Write-Output $result
`;

  try {
    const { stdout, stderr } = await runPowerShell(script, { timeout: 60000 });

    // Check for JSON error response
    const output = stdout.trim();
    if (output.startsWith('{') && output.includes('"error"')) {
      try {
        const errorObj = JSON.parse(output);
        if (errorObj.error) {
          throw new Error(errorObj.error);
        }
      } catch (e) {
        if (e.message !== output) throw e;
      }
    }

    let rawResults = [];
    try {
      if (output && output !== '[]') {
        rawResults = JSON.parse(output);
        // Handle single object case (PowerShell quirk when only 1 result)
        if (!Array.isArray(rawResults)) {
          rawResults = [rawResults];
        }
      }
    } catch (parseError) {
      console.error('[ui-parse-tools] JSON parse error:', parseError.message, 'Output:', output.substring(0, 500));
      throw new Error(`Failed to parse OCR output: ${parseError.message}`);
    }

    const elements = rawResults.map((r, idx) => ({
      id: idx,
      type: 'text',
      label: r.text || '',
      interactivity: (r.text || '').length <= 40,
      confidence: 1.0,
      bbox: {
        left: r.left,
        top: r.top,
        right: r.left + r.width,
        bottom: r.top + r.height,
        width: r.width,
        height: r.height,
      },
      center: {
        x: r.left + Math.floor(r.width / 2),
        y: r.top + Math.floor(r.height / 2),
      },
    }));

    console.log(`[ui-parse-tools] Windows OCR found ${elements.length} elements`);
    return { elements, parser: 'windows_ocr' };

  } catch (error) {
    console.error('[ui-parse-tools] Windows OCR failed:', error.message);
    throw error;
  }
}

/**
 * Run Tesseract OCR (if installed)
 */
async function runTesseractOCR(imagePath, maxElements = 80, minConfidence = 25) {
  // Check common Tesseract installation paths
  const possiblePaths = [
    'C:\\Users\\vatsal\\AppData\\Local\\Programs\\Tesseract-OCR\\tesseract.exe',
    'C:\\Program Files\\Tesseract-OCR\\tesseract.exe',
    'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe',
    'tesseract' // Fallback to PATH
  ];

  let tesseractPath = 'tesseract';
  for (const p of possiblePaths) {
    if (p === 'tesseract' || fs.existsSync(p)) {
      tesseractPath = p;
      break;
    }
  }

  console.log(`[ui-parse-tools] Using Tesseract at: ${tesseractPath}`);

  const { stdout } = await spawnCommand(
    tesseractPath,
    [imagePath, 'stdout', '-c', 'tessedit_create_tsv=1'],
    { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
  );

  const lines = stdout.trim().split('\n');
  const elements = [];

  // Parse TSV output (skip header)
  for (let i = 1; i < lines.length && elements.length < maxElements; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 12) continue;

    const conf = parseInt(parts[10]) || 0;
    const text = parts[11] || '';

    if (conf < minConfidence || !text.trim()) continue;

    const left = parseInt(parts[6]) || 0;
    const top = parseInt(parts[7]) || 0;
    const width = parseInt(parts[8]) || 0;
    const height = parseInt(parts[9]) || 0;

    elements.push({
      id: elements.length,
      type: 'text',
      label: text.trim(),
      interactivity: text.trim().length <= 40,
      confidence: conf / 100,
      bbox: {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
      },
      center: {
        x: left + Math.floor(width / 2),
        y: top + Math.floor(height / 2),
      },
    });
  }

  return { elements, parser: 'tesseract' };
}

const definitions = [
  {
    name: 'desktop_ui_parse',
    description:
      'Vision-based UI parsing using OCR. Two-step workflow: (1) get_ui_elements captures screen, runs OCR, stores results, returns parse_session_id and element list. (2) get_ui_element_coords retrieves full element details by ID. Use before clicking with desktop_mouse.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['get_ui_elements', 'get_ui_element_coords'],
          description: 'get_ui_elements first; then get_ui_element_coords for chosen IDs.',
        },
        region: {
          type: 'object',
          properties: {
            left: { type: 'number' },
            top: { type: 'number' },
            width: { type: 'number' },
            height: { type: 'number' },
          },
          description: 'Optional rectangle for get_ui_elements; omit for full screen.',
        },
        max_elements: {
          type: 'integer',
          description: 'get_ui_elements: max elements (default 80, max 200).',
        },
        parse_session_id: {
          type: 'string',
          description: 'get_ui_element_coords: session ID from get_ui_elements.',
        },
        element_ids: {
          type: 'array',
          items: { type: 'integer' },
          description: 'get_ui_element_coords: element IDs to resolve (max 64).',
        },
      },
      required: ['action'],
    },
  },
];

const handlers = {
  async desktop_ui_parse(input) {
    if (!IS_WINDOWS) {
      return { success: false, error: 'desktop_ui_parse is only available on Windows' };
    }

    const action = input.action;

    if (action === 'get_ui_elements') {
      const region = input.region;
      const maxElements = Math.min(Math.max(input.max_elements || 80, 1), 200);

      let tempFile, captureWidth, captureHeight;
      try {
        const capture = await captureScreenshot(region);
        tempFile = capture.tempFile;
        captureWidth = capture.captureWidth;
        captureHeight = capture.captureHeight;
      } catch (error) {
        return { success: false, error: `Screenshot failed: ${error.message}` };
      }

      let elements = [];
      let parser = 'none';
      try {
        const ocrResult = await runOCR(tempFile, maxElements);
        elements = ocrResult.elements || [];
        parser = ocrResult.parser || 'unknown';
        if (ocrResult.error) {
          console.warn('OCR warning:', ocrResult.error);
        }
      } catch (error) {
        console.error('OCR failed:', error);
      }

      // Clean up temp file
      try {
        fs.unlinkSync(tempFile);
      } catch {}

      // Apply region offset if specified
      if (region) {
        for (const el of elements) {
          el.bbox.left += region.left;
          el.bbox.right += region.left;
          el.bbox.top += region.top;
          el.bbox.bottom += region.top;
          el.center.x += region.left;
          el.center.y += region.top;
        }
      }

      // Store session
      const sessionId = storeSession(elements, {
        parser,
        captureWidth,
        captureHeight,
      });

      // Build labels text and IDs
      const labelsText = elements.map(el => el.label || '(unlabeled)').join('\n');
      const elementIds = elements.map(el => el.id);

      return {
        success: true,
        parse_session_id: sessionId,
        labels_text: labelsText,
        element_ids: elementIds,
        element_count: elements.length,
        parser,
        capture_width: captureWidth,
        capture_height: captureHeight,
        screen_space_note: 'bbox and center are absolute screen pixels.',
      };
    }

    if (action === 'get_ui_element_coords') {
      const sessionId = input.parse_session_id;
      const elementIds = input.element_ids;

      if (!sessionId || typeof sessionId !== 'string') {
        return { success: false, error: 'get_ui_element_coords requires parse_session_id' };
      }

      if (!elementIds || !Array.isArray(elementIds) || elementIds.length === 0) {
        return { success: false, error: 'get_ui_element_coords requires element_ids array' };
      }

      if (elementIds.length > 64) {
        return { success: false, error: 'element_ids must have at most 64 entries' };
      }

      const session = getSession(sessionId);
      if (!session) {
        return { success: false, error: 'Unknown or expired parse_session_id. Run get_ui_elements again.' };
      }

      const elementsById = new Map(session.elements.map(el => [el.id, el]));
      const missing = elementIds.filter(id => !elementsById.has(id));
      if (missing.length > 0) {
        return {
          success: false,
          error: 'Some element_ids are not in this parse session.',
          invalid_element_ids: missing,
        };
      }

      const resolved = elementIds.map(id => elementsById.get(id));

      return {
        success: true,
        parse_session_id: sessionId,
        elements: resolved,
        screen_space_note: session.metadata.screen_space_note || '',
      };
    }

    return { success: false, error: `Unknown action: ${action}` };
  },
};

module.exports = { definitions, handlers };
