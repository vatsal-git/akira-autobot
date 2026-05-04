/**
 * Shared PowerShell utilities for desktop tools
 * Upgraded to use spawn() for better control and streaming
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const IS_WINDOWS = process.platform === 'win32';

/**
 * Execute a command using spawn with timeout support
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} options - Options (timeout, maxBuffer, shell, cwd)
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function spawnCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const { timeout = 30000, maxBuffer = 10 * 1024 * 1024, cwd } = options;

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
        if (!child.killed) {
          child.kill('SIGKILL');
        }
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
      if (stderr.length > maxBuffer) {
        killed = true;
        child.kill('SIGTERM');
      }
    });

    child.on('close', (code) => {
      clearTimeout(timeoutId);

      if (killed) {
        reject(Object.assign(new Error(`Command timed out or exceeded buffer`), {
          killed: true,
          stdout,
          stderr
        }));
      } else if (code !== 0) {
        reject(Object.assign(new Error(`Command failed with code ${code}`), {
          code,
          stdout,
          stderr
        }));
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

/**
 * Execute PowerShell command by writing to a temp .ps1 file (avoids escaping issues)
 */
async function runPowerShell(script, options = {}) {
  if (!IS_WINDOWS) {
    throw new Error('Desktop control is only available on Windows');
  }

  const timeout = options.timeout || 10000;
  const scriptFile = path.join(os.tmpdir(), `ps_script_${Date.now()}_${Math.random().toString(36).slice(2)}.ps1`);

  try {
    fs.writeFileSync(scriptFile, script, 'utf8');

    const { stdout, stderr } = await spawnCommand(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile],
      { timeout }
    );

    if (stderr && stderr.trim()) {
      console.warn('[desktop-tools] PowerShell stderr:', stderr.trim());
    }

    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    console.error('[desktop-tools] PowerShell error:', error.message);
    if (error.stderr) {
      console.error('[desktop-tools] PowerShell stderr:', error.stderr);
    }
    throw new Error(`PowerShell failed: ${error.message}${error.stderr ? ' - ' + error.stderr : ''}`);
  } finally {
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
    const { stdout, stderr } = await spawnCommand(
      'cmd.exe',
      ['/c', command],
      { timeout }
    );
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
  try {
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      $screen = [System.Windows.Forms.Screen]::PrimaryScreen
      Write-Output "$($screen.Bounds.Width),$($screen.Bounds.Height)"
    `;
    const { stdout } = await runPowerShell(script);
    const [width, height] = stdout.split(',').map(Number);

    if (width > 0 && height > 0 && !isNaN(width) && !isNaN(height)) {
      return { width, height };
    }
    console.warn('[desktop-tools] PowerShell returned invalid screen size, trying fallback');
  } catch (error) {
    console.warn('[desktop-tools] PowerShell getScreenSize failed:', error.message);
  }

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
  spawnCommand,
  runPowerShell,
  runCmd,
  getScreenSize,
  getMousePosition,
  moveMouse,
};
