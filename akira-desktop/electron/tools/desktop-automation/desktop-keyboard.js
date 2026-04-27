/**
 * Desktop Keyboard Tool
 * desktop_keyboard - Keyboard input: type text, press single keys, or send hotkey combinations
 */

const { runPowerShell } = require('../utils/powershell');

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

const definitions = [
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
];

const handlers = {
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
};

module.exports = { definitions, handlers };
