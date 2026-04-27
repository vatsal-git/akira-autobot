/**
 * Camera/Webcam Tools
 * camera_capture - Capture photo from webcam
 */

const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execPromise = util.promisify(exec);

const IS_WINDOWS = process.platform === 'win32';
const MAX_PHOTO_B64_CHARS = 200000; // ~150KB base64

/**
 * Capture photo using FFmpeg (cross-platform, if installed)
 */
async function captureWithFFmpeg(cameraIndex = 0, warmupFrames = 5) {
  const tempFile = path.join(os.tmpdir(), `akira_camera_${Date.now()}.jpg`);

  // On Windows, use dshow
  // On Linux, use v4l2
  // On Mac, use avfoundation
  let inputDevice;
  if (IS_WINDOWS) {
    inputDevice = `-f dshow -i video="USB Camera"`;
    // Try to get actual device name
    try {
      const { stdout } = await execPromise('ffmpeg -list_devices true -f dshow -i dummy 2>&1', { timeout: 5000 });
      const match = stdout.match(/"([^"]+)" \(video\)/);
      if (match) {
        inputDevice = `-f dshow -i video="${match[1]}"`;
      }
    } catch {}
  } else {
    inputDevice = `-f v4l2 -i /dev/video${cameraIndex}`;
  }

  // Capture single frame after warmup
  const ffmpegCmd = `ffmpeg -y ${inputDevice} -frames:v ${warmupFrames + 1} -q:v 2 "${tempFile}" 2>&1`;

  try {
    await execPromise(ffmpegCmd, { timeout: 30000 });

    if (!fs.existsSync(tempFile)) {
      throw new Error('FFmpeg did not create output file');
    }

    const imageBuffer = fs.readFileSync(tempFile);
    const base64 = imageBuffer.toString('base64');

    // Clean up
    fs.unlinkSync(tempFile);

    return {
      success: true,
      format: 'jpeg',
      base64,
      method: 'ffmpeg',
    };
  } catch (error) {
    // Clean up on error
    try { fs.unlinkSync(tempFile); } catch {}
    throw error;
  }
}

/**
 * Capture photo using PowerShell and Windows Media Foundation (Windows only)
 */
async function captureWithPowerShell(cameraIndex = 0, warmupFrames = 5) {
  if (!IS_WINDOWS) {
    throw new Error('PowerShell capture is only available on Windows');
  }

  const tempFile = path.join(os.tmpdir(), `akira_camera_${Date.now()}.jpg`);

  // Use AForge.NET or direct COM if available, otherwise use PowerShell with .NET
  // This uses a simpler approach with Windows Image Acquisition (WIA)
  const script = `
    Add-Type -AssemblyName System.Drawing

    # Try to use OpenCV via Python if available
    try {
      $pythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source
      if ($pythonPath) {
        $pyScript = @"
import cv2
import sys
cap = cv2.VideoCapture(${cameraIndex})
if not cap.isOpened():
    sys.exit(1)
for i in range(${warmupFrames + 1}):
    ret, frame = cap.read()
if ret:
    cv2.imwrite(r'${tempFile.replace(/\\/g, '\\\\')}', frame)
    print('OK')
cap.release()
"@
        $result = $pyScript | python -
        if ($result -eq 'OK') {
          Write-Output 'PYTHON_OK'
          exit
        }
      }
    } catch {}

    # Fallback: Use escapi or similar
    # Since we can't easily capture camera in pure PowerShell without deps,
    # we'll try ffmpeg as a command
    try {
      $ffmpegPath = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
      if ($ffmpegPath) {
        # List video devices
        $devices = & ffmpeg -list_devices true -f dshow -i dummy 2>&1
        $videoDevice = $null
        foreach ($line in $devices -split '\\n') {
          if ($line -match '"([^"]+)" \\(video\\)') {
            $videoDevice = $matches[1]
            break
          }
        }

        if ($videoDevice) {
          & ffmpeg -y -f dshow -i "video=$videoDevice" -frames:v ${warmupFrames + 1} -q:v 2 '${tempFile.replace(/\\/g, '\\\\')}' 2>&1
          if (Test-Path '${tempFile.replace(/\\/g, '\\\\')}') {
            Write-Output 'FFMPEG_OK'
            exit
          }
        }
      }
    } catch {}

    Write-Output 'NO_CAMERA'
  `;

  const { stdout, stderr } = await execPromise(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`,
    { timeout: 60000 }
  );

  const result = stdout.trim();

  if (result === 'PYTHON_OK' || result === 'FFMPEG_OK') {
    if (fs.existsSync(tempFile)) {
      const imageBuffer = fs.readFileSync(tempFile);
      let base64 = imageBuffer.toString('base64');

      // Resize if too large
      if (base64.length > MAX_PHOTO_B64_CHARS) {
        // Use PowerShell to resize
        const resizeScript = `
          Add-Type -AssemblyName System.Drawing
          $img = [System.Drawing.Image]::FromFile('${tempFile.replace(/\\/g, '\\\\')}')
          $ratio = [Math]::Min(1024.0 / $img.Width, 1024.0 / $img.Height)
          if ($ratio -lt 1) {
            $newWidth = [int]($img.Width * $ratio)
            $newHeight = [int]($img.Height * $ratio)
            $bitmap = New-Object System.Drawing.Bitmap($newWidth, $newHeight)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($img, 0, 0, $newWidth, $newHeight)
            $img.Dispose()
            $bitmap.Save('${tempFile.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Jpeg)
            $graphics.Dispose()
            $bitmap.Dispose()
          } else {
            $img.Dispose()
          }
        `;

        await execPromise(
          `powershell -NoProfile -ExecutionPolicy Bypass -Command "${resizeScript.replace(/"/g, '\\"')}"`,
          { timeout: 30000 }
        );

        const resizedBuffer = fs.readFileSync(tempFile);
        base64 = resizedBuffer.toString('base64');
      }

      fs.unlinkSync(tempFile);

      return {
        success: true,
        format: 'jpeg',
        base64,
        method: result === 'PYTHON_OK' ? 'python_opencv' : 'ffmpeg',
      };
    }
  }

  throw new Error(
    'Could not capture from camera. Ensure a webcam is connected and either FFmpeg or Python with OpenCV is installed. ' +
    'Windows privacy settings must also allow camera access for desktop apps.'
  );
}

/**
 * Try multiple capture methods
 */
async function capturePhoto(cameraIndex = 0, warmupFrames = 5) {
  const errors = [];

  // Try PowerShell method first (uses ffmpeg or python internally)
  if (IS_WINDOWS) {
    try {
      return await captureWithPowerShell(cameraIndex, warmupFrames);
    } catch (e) {
      errors.push(`PowerShell: ${e.message}`);
    }
  }

  // Try direct FFmpeg
  try {
    return await captureWithFFmpeg(cameraIndex, warmupFrames);
  } catch (e) {
    errors.push(`FFmpeg: ${e.message}`);
  }

  throw new Error(
    `Camera capture failed. Tried methods: ${errors.join('; ')}. ` +
    'Install FFmpeg or Python with OpenCV (cv2) for camera support.'
  );
}

const definitions = [
  {
    name: 'camera_capture',
    description:
      'Capture a single photo from the webcam. Returns JPEG as base64. Requires FFmpeg or Python with OpenCV. User must grant camera access in Windows settings if capture fails.',
    input_schema: {
      type: 'object',
      properties: {
        camera_index: {
          type: 'integer',
          description: 'Webcam index (usually 0 for default camera).',
          default: 0,
        },
        warmup_frames: {
          type: 'integer',
          description: 'Frames to discard before capture (helps stabilize). Default 5, max 30.',
          default: 5,
        },
      },
      required: [],
    },
  },
];

const handlers = {
  async camera_capture(input) {
    const cameraIndex = Math.max(0, Math.min(input.camera_index || 0, 16));
    const warmupFrames = Math.max(0, Math.min(input.warmup_frames || 5, 30));

    try {
      const result = await capturePhoto(cameraIndex, warmupFrames);
      return {
        success: true,
        format: result.format,
        base64: result.base64,
        camera_index: cameraIndex,
        method: result.method,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        camera_index: cameraIndex,
      };
    }
  },
};

module.exports = { definitions, handlers };
