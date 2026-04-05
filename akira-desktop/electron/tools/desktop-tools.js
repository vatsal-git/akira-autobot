/**
 * Desktop Control Tools
 * desktop_mouse, desktop_keyboard, desktop_screen_query, desktop_wait
 *
 * Uses PowerShell on Windows for mouse/keyboard control (no native deps needed)
 * Screenshots use Electron's desktopCapturer
 */

const { exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const os = require('os');

const execPromise = util.promisify(exec);

const IS_WINDOWS = process.platform === 'win32';

/**
 * Execute PowerShell command (Windows only)
 */
async function runPowerShell(script) {
  if (!IS_WINDOWS) {
    throw new Error('Desktop control is only available on Windows');
  }

  const { stdout, stderr } = await execPromise(
    `powershell -NoProfile -ExecutionPolicy Bypass -Command "${script.replace(/"/g, '\\"')}"`,
    { timeout: 10000 }
  );

  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

/**
 * Get screen size using PowerShell
 */
async function getScreenSize() {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen
    Write-Output "$($screen.Bounds.Width),$($screen.Bounds.Height)"
  `;
  const { stdout } = await runPowerShell(script);
  const [width, height] = stdout.split(',').map(Number);
  return { width, height };
}

/**
 * Get mouse position using PowerShell
 */
async function getMousePosition() {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $pos = [System.Windows.Forms.Cursor]::Position
    Write-Output "$($pos.X),$($pos.Y)"
  `;
  const { stdout } = await runPowerShell(script);
  const [x, y] = stdout.split(',').map(Number);
  return { x, y };
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

/**
 * Mouse click using PowerShell and user32.dll
 */
async function mouseClick(button = 'left', x = null, y = null) {
  let moveScript = '';
  if (x !== null && y !== null) {
    moveScript = `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y}); Start-Sleep -Milliseconds 50;`;
  }

  const clickScript = button === 'right'
    ? `$signature='[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int info);'; $t=Add-Type -MemberDefinition $signature -Name SendMouseClick -Namespace Win32 -PassThru; $t::mouse_event(0x0008, 0, 0, 0, 0); $t::mouse_event(0x0010, 0, 0, 0, 0);`
    : `$signature='[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int info);'; $t=Add-Type -MemberDefinition $signature -Name SendMouseClick -Namespace Win32 -PassThru; $t::mouse_event(0x0002, 0, 0, 0, 0); $t::mouse_event(0x0004, 0, 0, 0, 0);`;

  const script = `Add-Type -AssemblyName System.Windows.Forms; ${moveScript} ${clickScript}`;
  await runPowerShell(script);

  return { clicked: true, button, x, y };
}

/**
 * Type text using PowerShell SendKeys
 */
async function typeText(text) {
  // Escape special SendKeys characters
  const escaped = text
    .replace(/\+/g, '{+}')
    .replace(/\^/g, '{^}')
    .replace(/%/g, '{%}')
    .replace(/~/g, '{~}')
    .replace(/\(/g, '{(}')
    .replace(/\)/g, '{)}')
    .replace(/\[/g, '{[}')
    .replace(/\]/g, '{]}')
    .replace(/\{/g, '{{}')
    .replace(/\}/g, '{}}');

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
  `;
  await runPowerShell(script);
  return { typed_length: text.length };
}

/**
 * Press a key using PowerShell SendKeys
 */
async function pressKey(key) {
  // Map common key names to SendKeys format
  const keyMap = {
    'enter': '{ENTER}',
    'return': '{ENTER}',
    'tab': '{TAB}',
    'escape': '{ESC}',
    'esc': '{ESC}',
    'backspace': '{BACKSPACE}',
    'delete': '{DELETE}',
    'del': '{DELETE}',
    'home': '{HOME}',
    'end': '{END}',
    'pageup': '{PGUP}',
    'pagedown': '{PGDN}',
    'up': '{UP}',
    'down': '{DOWN}',
    'left': '{LEFT}',
    'right': '{RIGHT}',
    'f1': '{F1}', 'f2': '{F2}', 'f3': '{F3}', 'f4': '{F4}',
    'f5': '{F5}', 'f6': '{F6}', 'f7': '{F7}', 'f8': '{F8}',
    'f9': '{F9}', 'f10': '{F10}', 'f11': '{F11}', 'f12': '{F12}',
    'space': ' ',
  };

  const sendKey = keyMap[key.toLowerCase()] || key;

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${sendKey}')
  `;
  await runPowerShell(script);
  return { pressed: key };
}

/**
 * Send hotkey combination
 */
async function hotkey(keys) {
  // Map modifier keys
  const modMap = {
    'ctrl': '^',
    'control': '^',
    'alt': '%',
    'shift': '+',
    'win': '^{ESC}', // Approximation
  };

  let combo = '';
  for (const key of keys) {
    const k = key.toLowerCase();
    if (modMap[k]) {
      combo += modMap[k];
    } else {
      combo += key;
    }
  }

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.SendKeys]::SendWait('${combo}')
  `;
  await runPowerShell(script);
  return { hotkey: keys };
}

/**
 * Take screenshot using PowerShell
 */
async function takeScreenshot(region = null) {
  const tempFile = path.join(os.tmpdir(), `akira_screenshot_${Date.now()}.png`);
  const escapedPath = tempFile.replace(/\\/g, '\\\\');

  let script;
  if (region) {
    script = `
      try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $left = ${region.left}
        $top = ${region.top}
        $width = ${region.width}
        $height = ${region.height}
        $bitmap = New-Object System.Drawing.Bitmap($width, $height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($left, $top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
        $bitmap.Save('${escapedPath}')
        $graphics.Dispose()
        $bitmap.Dispose()
        Write-Output 'OK'
      } catch {
        Write-Error $_.Exception.Message
        exit 1
      }
    `;
  } else {
    script = `
      try {
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen
        $bitmap = New-Object System.Drawing.Bitmap($screen.Bounds.Width, $screen.Bounds.Height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($screen.Bounds.Location, [System.Drawing.Point]::Empty, $screen.Bounds.Size)
        $bitmap.Save('${escapedPath}')
        $graphics.Dispose()
        $bitmap.Dispose()
        Write-Output 'OK'
      } catch {
        Write-Error $_.Exception.Message
        exit 1
      }
    `;
  }

  const { stdout, stderr } = await runPowerShell(script);

  if (stderr) {
    throw new Error(`Screenshot failed: ${stderr}`);
  }

  // Check file exists
  if (!fs.existsSync(tempFile)) {
    throw new Error(`Screenshot file not created. PowerShell output: ${stdout}`);
  }

  // Read and convert to base64
  const imageBuffer = fs.readFileSync(tempFile);
  const base64 = imageBuffer.toString('base64');

  // Clean up temp file
  fs.unlinkSync(tempFile);

  return {
    format: 'png',
    base64,
    width: region ? region.width : undefined,
    height: region ? region.height : undefined,
  };
}

/**
 * Scroll mouse wheel
 */
async function scroll(amount) {
  const wheelDelta = amount * 120; // Standard wheel delta
  const script = `
    $signature='[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int info);'
    $t=Add-Type -MemberDefinition $signature -Name SendMouseWheel -Namespace Win32 -PassThru
    $t::mouse_event(0x0800, 0, 0, ${wheelDelta}, 0)
  `;
  await runPowerShell(script);
  return { scrolled: amount };
}

const definitions = [
  {
    name: 'desktop_mouse',
    description: 'Mouse control: move, click, double-click, right-click, middle-click, scroll, drag. Coordinates are screen pixels (top-left origin). When x,y are set on click actions, pointer moves there first.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['move_mouse', 'click', 'double_click', 'right_click', 'middle_click', 'scroll', 'drag'],
          description: 'Mouse operation to perform',
        },
        x: { type: 'number', description: 'Screen X coordinate' },
        y: { type: 'number', description: 'Screen Y coordinate' },
        button: {
          type: 'string',
          enum: ['left', 'right', 'middle'],
          description: 'Mouse button (default: left)',
        },
        scroll_amount: {
          type: 'integer',
          description: 'Scroll wheel steps (positive = up, negative = down)',
        },
        clicks: {
          type: 'integer',
          description: 'Deprecated alias for scroll_amount (scroll only). Prefer scroll_amount.',
        },
        duration_seconds: {
          type: 'number',
          description: 'Animation duration for move_mouse/drag; optional animated move before click when x,y are set.',
        },
        start_x: { type: 'number', description: 'Drag start X' },
        start_y: { type: 'number', description: 'Drag start Y' },
        end_x: { type: 'number', description: 'Drag end X' },
        end_y: { type: 'number', description: 'Drag end Y' },
      },
      required: ['action'],
    },
  },
  {
    name: 'desktop_keyboard',
    description: 'Keyboard input: type text, press single keys, or send hotkey combinations. Key names follow PyAutoGUI (enter, tab, esc, win, ctrl, alt). type_text is ASCII-oriented; use press_key or hotkey for special keys.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['type_text', 'press_key', 'hotkey'],
          description: 'Keyboard operation',
        },
        text: { type: 'string', description: 'Text to type (for type_text); ASCII is most reliable.' },
        interval: {
          type: 'number',
          description: 'Seconds between keystrokes for type_text (default 0).',
        },
        key: { type: 'string', description: 'Key to press (for press_key), e.g. enter, backspace.' },
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key combination for hotkey, e.g. ["ctrl", "s"].',
        },
      },
      required: ['action'],
    },
  },
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
  {
    name: 'desktop_wait',
    description: 'Wait/sleep for a specified duration (0-30 seconds). Use between UI actions.',
    input_schema: {
      type: 'object',
      properties: {
        seconds: {
          type: 'number',
          description: 'Duration to wait (0-30 seconds)',
        },
      },
      required: ['seconds'],
    },
  },
];

/**
 * Move mouse with optional animation duration
 */
async function moveMouseAnimated(x, y, durationSeconds = null) {
  if (durationSeconds && durationSeconds > 0) {
    // Animated move using multiple steps
    const pos = await getMousePosition();
    const steps = Math.max(10, Math.ceil(durationSeconds * 60));
    const dx = (x - pos.x) / steps;
    const dy = (y - pos.y) / steps;
    const delay = (durationSeconds * 1000) / steps;

    for (let i = 1; i <= steps; i++) {
      await moveMouse(Math.round(pos.x + dx * i), Math.round(pos.y + dy * i));
      await new Promise(r => setTimeout(r, delay));
    }
    return { x, y };
  }
  return await moveMouse(x, y);
}

/**
 * Middle click using PowerShell
 */
async function middleClick(x = null, y = null) {
  let moveScript = '';
  if (x !== null && y !== null) {
    moveScript = `[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y}); Start-Sleep -Milliseconds 50;`;
  }

  const script = `Add-Type -AssemblyName System.Windows.Forms; ${moveScript} $signature='[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int data, int info);'; $t=Add-Type -MemberDefinition $signature -Name SendMiddleClick -Namespace Win32 -PassThru; $t::mouse_event(0x0020, 0, 0, 0, 0); $t::mouse_event(0x0040, 0, 0, 0, 0);`;
  await runPowerShell(script);

  return { middle_clicked: true, x, y };
}

/**
 * Type text with optional interval between keystrokes
 */
async function typeTextWithInterval(text, interval = 0) {
  if (!interval || interval <= 0) {
    return await typeText(text);
  }

  // Type character by character with delays
  const chars = text.split('');
  for (const char of chars) {
    // Escape special SendKeys characters
    let escaped = char
      .replace(/\+/g, '{+}')
      .replace(/\^/g, '{^}')
      .replace(/%/g, '{%}')
      .replace(/~/g, '{~}')
      .replace(/\(/g, '{(}')
      .replace(/\)/g, '{)}')
      .replace(/\[/g, '{[}')
      .replace(/\]/g, '{]}')
      .replace(/\{/g, '{{}')
      .replace(/\}/g, '{}}');

    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${escaped.replace(/'/g, "''")}')
    `;
    await runPowerShell(script);
    await new Promise(r => setTimeout(r, interval * 1000));
  }

  return { typed_length: text.length };
}

const handlers = {
  async desktop_mouse(input) {
    const action = input.action;
    const duration = input.duration_seconds;

    switch (action) {
      case 'move_mouse':
        if (input.x == null || input.y == null) {
          return { success: false, error: 'move_mouse requires x and y' };
        }
        return await moveMouseAnimated(input.x, input.y, duration);

      case 'click':
        const btn = input.button || 'left';
        if (btn !== 'left' && btn !== 'right' && btn !== 'middle') {
          return { success: false, error: 'button must be left, right, or middle' };
        }
        if (input.x != null && input.y != null && duration) {
          await moveMouseAnimated(input.x, input.y, duration);
          return await mouseClick(btn);
        }
        return await mouseClick(btn, input.x, input.y);

      case 'double_click':
        if (input.x != null && input.y != null && duration) {
          await moveMouseAnimated(input.x, input.y, duration);
        } else if (input.x != null && input.y != null) {
          await moveMouse(input.x, input.y);
          await new Promise(r => setTimeout(r, 50));
        }
        await mouseClick('left');
        await new Promise(r => setTimeout(r, 50));
        const result = await mouseClick('left');
        return { double_clicked: true, x: input.x, y: input.y };

      case 'right_click':
        if (input.x != null && input.y != null && duration) {
          await moveMouseAnimated(input.x, input.y, duration);
          return { right_clicked: true, ...(await mouseClick('right')) };
        }
        return await mouseClick('right', input.x, input.y);

      case 'middle_click':
        if (input.x != null && input.y != null && duration) {
          await moveMouseAnimated(input.x, input.y, duration);
          return await middleClick();
        }
        return await middleClick(input.x, input.y);

      case 'scroll':
        let amount = input.scroll_amount;
        if (amount == null) {
          amount = input.clicks; // Deprecated alias
        }
        if (amount == null) {
          return { success: false, error: 'scroll requires scroll_amount (integer wheel steps: positive up, negative down)' };
        }
        return await scroll(amount);

      case 'drag':
        if ([input.start_x, input.start_y, input.end_x, input.end_y].some(v => v == null)) {
          return { success: false, error: 'drag requires start_x, start_y, end_x, end_y' };
        }
        await moveMouse(input.start_x, input.start_y);
        await new Promise(r => setTimeout(r, 50));
        // Mouse down
        await runPowerShell(`$sig='[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int i);';$t=Add-Type -MemberDefinition $sig -Name MD -Namespace W -PassThru;$t::mouse_event(0x0002,0,0,0,0);`);
        await new Promise(r => setTimeout(r, 50));
        if (duration) {
          await moveMouseAnimated(input.end_x, input.end_y, duration);
        } else {
          await moveMouse(input.end_x, input.end_y);
        }
        await new Promise(r => setTimeout(r, 50));
        // Mouse up
        await runPowerShell(`$sig='[DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int i);';$t=Add-Type -MemberDefinition $sig -Name MU -Namespace W -PassThru;$t::mouse_event(0x0004,0,0,0,0);`);
        return { dragged: true, start_x: input.start_x, start_y: input.start_y, end_x: input.end_x, end_y: input.end_y };

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },

  async desktop_keyboard(input) {
    const action = input.action;

    switch (action) {
      case 'type_text':
        if (!input.text && input.text !== '') {
          return { success: false, error: 'type_text requires text' };
        }
        if (input.interval && input.interval > 0) {
          return await typeTextWithInterval(input.text, input.interval);
        }
        return await typeText(input.text);

      case 'press_key':
        if (!input.key) {
          return { success: false, error: 'press_key requires key' };
        }
        return await pressKey(input.key);

      case 'hotkey':
        if (!input.keys || !Array.isArray(input.keys) || input.keys.length === 0) {
          return { success: false, error: 'hotkey requires keys as a non-empty array of strings' };
        }
        return await hotkey(input.keys);

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },

  async desktop_screen_query(input) {
    const action = input.action;

    switch (action) {
      case 'get_mouse_position':
        return await getMousePosition();

      case 'get_screen_size':
        return await getScreenSize();

      case 'screenshot':
        return await takeScreenshot(input.region);

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },

  async desktop_wait(input) {
    const seconds = input.seconds;

    if (seconds == null || seconds < 0 || seconds > 30) {
      return { success: false, error: 'seconds must be between 0 and 30' };
    }

    await new Promise(resolve => setTimeout(resolve, seconds * 1000));
    return { waited_seconds: seconds };
  },
};

module.exports = { definitions, handlers };
