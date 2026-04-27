/**
 * Shared PowerShell utilities for desktop tools
 */

const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execPromise = util.promisify(exec);

const IS_WINDOWS = process.platform === 'win32';

/**
 * Execute PowerShell command by writing to a temp .ps1 file (avoids escaping issues)
 */
async function runPowerShell(script, options = {}) {
  if (!IS_WINDOWS) {
    throw new Error('Desktop control is only available on Windows');
  }

  const timeout = options.timeout || 10000;
  const scriptFile = path.join(os.tmpdir(), `ps_script_${Date.now()}.ps1`);

  try {
    // Write script to temp file
    fs.writeFileSync(scriptFile, script, 'utf8');

    // Execute the script file
    const command = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptFile}"`;
    const { stdout, stderr } = await execPromise(command, { timeout });

    // Check for PowerShell errors in stderr
    if (stderr && stderr.trim()) {
      console.warn('[desktop-tools] PowerShell stderr:', stderr.trim());
    }

    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    // Capture PowerShell execution errors
    console.error('[desktop-tools] PowerShell error:', error.message);
    if (error.stderr) {
      console.error('[desktop-tools] PowerShell stderr:', error.stderr);
    }
    throw new Error(`PowerShell failed: ${error.message}${error.stderr ? ' - ' + error.stderr : ''}`);
  } finally {
    // Clean up script file
    try {
      if (fs.existsSync(scriptFile)) {
        fs.unlinkSync(scriptFile);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Execute cmd command as fallback (Windows only)
 */
async function runCmd(command, options = {}) {
  if (!IS_WINDOWS) {
    throw new Error('Desktop control is only available on Windows');
  }

  const timeout = options.timeout || 10000;

  try {
    const { stdout, stderr } = await execPromise(command, { timeout, shell: 'cmd.exe' });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    console.error('[desktop-tools] CMD error:', error.message);
    throw new Error(`CMD failed: ${error.message}`);
  }
}

/**
 * Get screen size using PowerShell with cmd fallback
 */
async function getScreenSize() {
  // Try PowerShell first
  try {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen
      Write-Output "$($screen.Bounds.Width),$($screen.Bounds.Height)"
    `;
    const { stdout } = await runPowerShell(script);
    const [width, height] = stdout.split(',').map(Number);

    // Validate the values
    if (width > 0 && height > 0 && !isNaN(width) && !isNaN(height)) {
      return { width, height };
    }
    console.warn('[desktop-tools] PowerShell returned invalid screen size, trying fallback');
  } catch (error) {
    console.warn('[desktop-tools] PowerShell getScreenSize failed:', error.message);
  }

  // Fallback: Use WMIC command via cmd
  try {
    const { stdout } = await runCmd('wmic path Win32_VideoController get CurrentHorizontalResolution,CurrentVerticalResolution /format:csv');
    const lines = stdout.split('\n').filter(line => line.trim() && !line.startsWith('Node'));
    if (lines.length > 0) {
      const parts = lines[0].split(',');
      if (parts.length >= 3) {
        const width = parseInt(parts[1]) || 0;
        const height = parseInt(parts[2]) || 0;
        if (width > 0 && height > 0) {
          return { width, height };
        }
      }
    }
  } catch (error) {
    console.warn('[desktop-tools] WMIC getScreenSize failed:', error.message);
  }

  // Final fallback: Return common resolution with error flag
  return { width: 1920, height: 1080, error: 'Could not detect screen size, using default 1920x1080' };
}

/**
 * Get mouse position using PowerShell
 */
async function getMousePosition() {
  try {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $pos = [System.Windows.Forms.Cursor]::Position
      Write-Output "$($pos.X),$($pos.Y)"
    `;
    const { stdout } = await runPowerShell(script);
    const [x, y] = stdout.split(',').map(Number);

    // Validate the values
    if (!isNaN(x) && !isNaN(y)) {
      return { x, y };
    }
    return { x: 0, y: 0, error: 'Invalid mouse position returned' };
  } catch (error) {
    return { x: 0, y: 0, error: `Failed to get mouse position: ${error.message}` };
  }
}

/**
 * Move mouse using PowerShell
 */
async function moveMouse(x, y) {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
  `;
  await runPowerShell(script);
  return { x, y };
}

module.exports = {
  IS_WINDOWS,
  runPowerShell,
  runCmd,
  getScreenSize,
  getMousePosition,
  moveMouse,
};
