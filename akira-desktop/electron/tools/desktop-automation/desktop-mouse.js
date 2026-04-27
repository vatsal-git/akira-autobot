/**
 * Desktop Mouse Tool
 * desktop_mouse - Mouse control: move, click, double-click, right-click, middle-click, scroll, drag
 */

const { runPowerShell, getMousePosition, moveMouse } = require('../utils/powershell');

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
];

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
        await mouseClick('left');
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
};

module.exports = { definitions, handlers };
