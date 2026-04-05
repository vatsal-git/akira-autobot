/**
 * UI Parse Tools
 * desktop_ui_parse - OCR-based UI element detection using Tesseract.js
 */

const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execPromise = util.promisify(exec);

const IS_WINDOWS = process.platform === 'win32';

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
 * Take screenshot and save to temp file
 */
async function captureScreenshot(region = null) {
  const tempFile = path.join(os.tmpdir(), `akira_ocr_${Date.now()}.png`);

  let script;
  if (region) {
    script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $bitmap = New-Object System.Drawing.Bitmap(${region.width}, ${region.height})
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen(${region.left}, ${region.top}, 0, 0, New-Object System.Drawing.Size(${region.width}, ${region.height}))
      $bitmap.Save('${tempFile.replace(/\\/g, '\\\\')}')
      $graphics.Dispose()
      $bitmap.Dispose()
    `;
  } else {
    script = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen
      $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
      $bitmap.Save('${tempFile.replace(/\\/g, '\\\\')}')
      $graphics.Dispose()
      $bitmap.Dispose()
      Write-Output "$($screen.Bounds.Width),$($screen.Bounds.Height)"
    `;
  }

  const { stdout } = await execPromise(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`,
    { timeout: 30000 }
  );

  let captureWidth, captureHeight;
  if (region) {
    captureWidth = region.width;
    captureHeight = region.height;
  } else {
    const parts = stdout.trim().split(',');
    captureWidth = parseInt(parts[0]) || 1920;
    captureHeight = parseInt(parts[1]) || 1080;
  }

  return { tempFile, captureWidth, captureHeight };
}

/**
 * Run OCR using Tesseract via PowerShell
 * Note: Requires Tesseract OCR to be installed on Windows
 * Alternative: Use Windows built-in OCR via UWP APIs
 */
async function runOCR(imagePath, maxElements = 80, minConfidence = 25) {
  // Try Windows OCR first (built-in, no installation needed)
  try {
    const result = await runWindowsOCR(imagePath, maxElements, minConfidence);
    if (result.elements && result.elements.length > 0) {
      return result;
    }
  } catch (e) {
    console.log('Windows OCR failed, falling back to Tesseract:', e.message);
  }

  // Fallback to Tesseract if installed
  try {
    return await runTesseractOCR(imagePath, maxElements, minConfidence);
  } catch (e) {
    console.log('Tesseract OCR failed:', e.message);
  }

  return { elements: [], error: 'OCR not available. Install Tesseract or use Windows 10+.' };
}

/**
 * Run Windows built-in OCR (Windows 10+)
 */
async function runWindowsOCR(imagePath, maxElements = 80, minConfidence = 25) {
  // Use Windows.Media.Ocr via PowerShell
  const script = `
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Ocr.OcrEngine,Windows.Media.Ocr,ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics.Imaging,ContentType=WindowsRuntime]
    $null = [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]

    function Await($WinRtTask, $ResultType) {
      $asTask = [System.WindowsRuntimeSystemExtensions].GetMethod('AsTask', [Type[]]@($WinRtTask.GetType()))
      $task = $asTask.Invoke($null, @($WinRtTask))
      $task.Wait()
      $task.Result
    }

    try {
      $file = [Windows.Storage.StorageFile]::GetFileFromPathAsync('${imagePath.replace(/\\/g, '\\\\')}')
      $storageFile = Await $file ([Windows.Storage.StorageFile])

      $stream = $storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)
      $randomAccessStream = Await $stream ([Windows.Storage.Streams.IRandomAccessStream])

      $decoder = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($randomAccessStream)
      $bitmapDecoder = Await $decoder ([Windows.Graphics.Imaging.BitmapDecoder])

      $bitmap = $bitmapDecoder.GetSoftwareBitmapAsync()
      $softwareBitmap = Await $bitmap ([Windows.Graphics.Imaging.SoftwareBitmap])

      $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
      if ($ocrEngine -eq $null) {
        $ocrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('en-US'))
      }

      $ocrResult = Await ($ocrEngine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])

      $results = @()
      $id = 0
      foreach ($line in $ocrResult.Lines) {
        foreach ($word in $line.Words) {
          $rect = $word.BoundingRect
          $results += [PSCustomObject]@{
            id = $id
            text = $word.Text
            left = [int]$rect.X
            top = [int]$rect.Y
            width = [int]$rect.Width
            height = [int]$rect.Height
          }
          $id++
          if ($id -ge ${maxElements}) { break }
        }
        if ($id -ge ${maxElements}) { break }
      }

      $randomAccessStream.Dispose()
      ConvertTo-Json -InputObject $results -Compress
    } catch {
      Write-Error $_.Exception.Message
      '[]'
    }
  `;

  const { stdout, stderr } = await execPromise(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`,
    { timeout: 60000, maxBuffer: 10 * 1024 * 1024 }
  );

  if (stderr && !stdout.trim()) {
    throw new Error(stderr);
  }

  let rawResults = [];
  try {
    rawResults = JSON.parse(stdout.trim() || '[]');
  } catch {
    rawResults = [];
  }

  const elements = rawResults.map((r, idx) => ({
    id: idx,
    type: 'text',
    label: r.text || '',
    interactivity: (r.text || '').length <= 40,
    confidence: 1.0, // Windows OCR doesn't provide confidence
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

  return { elements, parser: 'windows_ocr' };
}

/**
 * Run Tesseract OCR (if installed)
 */
async function runTesseractOCR(imagePath, maxElements = 80, minConfidence = 25) {
  // Check if Tesseract is installed
  const tesseractPath = 'tesseract'; // Assumes it's in PATH

  const { stdout } = await execPromise(
    `${tesseractPath} "${imagePath}" stdout -c tessedit_create_tsv=1`,
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
