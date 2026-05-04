/**
 * Desktop Keyboard Tool
 * desktop_keyboard - Keyboard input: type text, press single keys, or send hotkey combinations
 */

const { runPowerShell } = require('../utils/powershell');
const { emitAction } = require('../../overlay/overlay-events');

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
 * Press a key using keybd_event API (supports all keys including Win)
 */
async function pressKey(key) {
  // Virtual key codes
  const vkCodes = {
    'enter': 0x0D, 'return': 0x0D,
    'tab': 0x09,
    'escape': 0x1B, 'esc': 0x1B,
    'backspace': 0x08, 'back': 0x08,
    'delete': 0x2E, 'del': 0x2E,
    'insert': 0x2D, 'ins': 0x2D,
    'home': 0x24, 'end': 0x23,
    'pageup': 0x21, 'pgup': 0x21,
    'pagedown': 0x22, 'pgdn': 0x22,
    'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
    'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73,
    'f5': 0x74, 'f6': 0x75, 'f7': 0x76, 'f8': 0x77,
    'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
    'space': 0x20,
    'win': 0x5B, 'lwin': 0x5B, 'rwin': 0x5C,
    'ctrl': 0x11, 'control': 0x11,
    'alt': 0x12, 'shift': 0x10,
    'capslock': 0x14, 'numlock': 0x90, 'scrolllock': 0x91,
    'printscreen': 0x2C, 'prtsc': 0x2C,
    'pause': 0x13,
  };

  const k = key.toLowerCase();
  let vk;

  if (vkCodes[k] !== undefined) {
    vk = vkCodes[k];
  } else if (key.length === 1) {
    // Single character - use its char code
    vk = key.toUpperCase().charCodeAt(0);
  } else {
    // Unknown key, try SendKeys as fallback
    const script = `
      Add-Type -AssemblyName System.Windows.Forms
      [System.Windows.Forms.SendKeys]::SendWait('${key}')
    `;
    await runPowerShell(script);
    return { pressed: key };
  }

  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class KeyboardInput {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public const uint KEYEVENTF_KEYUP = 0x0002;
}
'@

# Press and release the key
[KeyboardInput]::keybd_event([byte]${vk}, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[KeyboardInput]::keybd_event([byte]${vk}, 0, [KeyboardInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
`;

  await runPowerShell(script);
  return { pressed: key };
}

/**
 * Send hotkey combination using keybd_event API for reliability
 * Works with all modifier keys including Windows key on Win10/Win11
 */
async function hotkey(keys) {
  // Virtual key codes for common keys
  const vkCodes = {
    // Modifiers
    'ctrl': 0x11, 'control': 0x11,
    'alt': 0x12, 'menu': 0x12,
    'shift': 0x10,
    'win': 0x5B, 'lwin': 0x5B, 'rwin': 0x5C,
    // Function keys
    'f1': 0x70, 'f2': 0x71, 'f3': 0x72, 'f4': 0x73,
    'f5': 0x74, 'f6': 0x75, 'f7': 0x76, 'f8': 0x77,
    'f9': 0x78, 'f10': 0x79, 'f11': 0x7A, 'f12': 0x7B,
    // Navigation
    'enter': 0x0D, 'return': 0x0D,
    'tab': 0x09,
    'escape': 0x1B, 'esc': 0x1B,
    'space': 0x20,
    'backspace': 0x08, 'back': 0x08,
    'delete': 0x2E, 'del': 0x2E,
    'insert': 0x2D, 'ins': 0x2D,
    'home': 0x24, 'end': 0x23,
    'pageup': 0x21, 'pgup': 0x21,
    'pagedown': 0x22, 'pgdn': 0x22,
    // Arrow keys
    'up': 0x26, 'down': 0x28, 'left': 0x25, 'right': 0x27,
    // Common keys
    'a': 0x41, 'b': 0x42, 'c': 0x43, 'd': 0x44, 'e': 0x45,
    'f': 0x46, 'g': 0x47, 'h': 0x48, 'i': 0x49, 'j': 0x4A,
    'k': 0x4B, 'l': 0x4C, 'm': 0x4D, 'n': 0x4E, 'o': 0x4F,
    'p': 0x50, 'q': 0x51, 'r': 0x52, 's': 0x53, 't': 0x54,
    'u': 0x55, 'v': 0x56, 'w': 0x57, 'x': 0x58, 'y': 0x59, 'z': 0x5A,
    '0': 0x30, '1': 0x31, '2': 0x32, '3': 0x33, '4': 0x34,
    '5': 0x35, '6': 0x36, '7': 0x37, '8': 0x38, '9': 0x39,
    // Punctuation/symbols
    'minus': 0xBD, '-': 0xBD,
    'plus': 0xBB, '=': 0xBB,
    'comma': 0xBC, ',': 0xBC,
    'period': 0xBE, '.': 0xBE,
    'slash': 0xBF, '/': 0xBF,
    'backslash': 0xDC, '\\': 0xDC,
    'semicolon': 0xBA, ';': 0xBA,
    'quote': 0xDE, "'": 0xDE,
    'bracketleft': 0xDB, '[': 0xDB,
    'bracketright': 0xDD, ']': 0xDD,
    'grave': 0xC0, '`': 0xC0,
    // Special
    'printscreen': 0x2C, 'prtsc': 0x2C,
    'scrolllock': 0x91,
    'pause': 0x13,
    'numlock': 0x90,
    'capslock': 0x14,
  };

  // Modifiers that should be held down first
  const modifierNames = ['ctrl', 'control', 'alt', 'menu', 'shift', 'win', 'lwin', 'rwin'];

  // Separate modifiers from regular keys, preserving order
  const modKeys = [];
  const regularKeys = [];
  for (const key of keys) {
    const k = key.toLowerCase();
    if (modifierNames.includes(k)) {
      modKeys.push(k);
    } else {
      regularKeys.push(k);
    }
  }

  // Get virtual key code for a key
  const getVk = (key) => {
    const k = key.toLowerCase();
    if (vkCodes[k] !== undefined) {
      return vkCodes[k];
    }
    // For single characters, use char code (works for A-Z, 0-9)
    if (key.length === 1) {
      return key.toUpperCase().charCodeAt(0);
    }
    throw new Error(`Unknown key: ${key}`);
  };

  // Build the key sequence: modifiers first, then regular keys
  const allKeys = [...modKeys, ...regularKeys];
  const vkList = allKeys.map(k => getVk(k));

  // Build PowerShell script using keybd_event (simpler and more reliable than SendInput)
  const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public class KeyboardInput {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    public const uint KEYEVENTF_KEYUP = 0x0002;
}
'@

$keys = @(${vkList.join(', ')})

# Press all keys down in order
foreach ($vk in $keys) {
    [KeyboardInput]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
}

# Release all keys in reverse order
[array]::Reverse($keys)
foreach ($vk in $keys) {
    [KeyboardInput]::keybd_event([byte]$vk, 0, [KeyboardInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
    Start-Sleep -Milliseconds 20
}
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
        emitAction({ type: 'type', text: input.text });
        if (input.interval && input.interval > 0) {
          return await typeTextWithInterval(input.text, input.interval);
        }
        return await typeText(input.text);

      case 'press_key':
        if (!input.key) {
          return { success: false, error: 'press_key requires key' };
        }
        emitAction({ type: 'key', key: input.key });
        return await pressKey(input.key);

      case 'hotkey':
        if (!input.keys || !Array.isArray(input.keys) || input.keys.length === 0) {
          return { success: false, error: 'hotkey requires keys as a non-empty array of strings' };
        }
        emitAction({ type: 'hotkey', keys: input.keys });
        return await hotkey(input.keys);

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  },
};

module.exports = { definitions, handlers };
