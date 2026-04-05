/**
 * System Tools
 * execute_command
 */

const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

// Dangerous command patterns to block
const DANGEROUS_PATTERNS = [
  // File/Disk Destruction
  /rm\s+-rf/i,
  /deltree/i,
  /rmdir\s+\/[sS]/i,
  /del\s+\/[fFsSqQ]/i,
  /format\s+[A-Z]:/i,
  /mkfs/i,
  /fdisk/i,
  /dd\s+if=/i,

  // User/Group Management
  /userdel/i,
  /groupdel/i,

  // System Power/State
  /shutdown/i,
  /reboot/i,
  /init\s+[06]/i,
  /halt/i,

  // Git Destruction
  /git\s+reset\s+--hard/i,
  /git\s+clean\s+-[fd]/i,

  // Network/Firewall Reset
  /iptables\s+-F/i,

  // Destructive Redirects
  />\s+\/dev\/sd/i,
  />\s+\/dev\/hd/i,

  // Permission Changes
  /chmod\s+-R/i,
  /chmod\s+777/i,

  // Windows system paths
  /(del|rmdir|rd)\s+.*C:\\Windows/i,
  /(del|rmdir|rd)\s+.*system32/i,
  /(del|rmdir|rd)\s+.*C:\\Program Files/i,

  // Unix system paths
  /rm\s+-rf\s+(\/etc|\/usr|\/var|\/boot|\/bin|\/sbin|\/root)/i,
];

function isCommandSafe(command) {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, pattern: pattern.toString() };
    }
  }
  return { safe: true };
}

// Reload callback - will be set by the main process
let reloadCallback = null;

function setReloadCallback(callback) {
  reloadCallback = callback;
}

const definitions = [
  {
    name: 'execute_command',
    description: 'Execute a shell command and return output. Dangerous commands (rm -rf, format, shutdown, etc.) are blocked for safety.',
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute. Must be non-destructive.',
        },
        timeout: {
          type: 'integer',
          description: 'Timeout in seconds (default: 30, max: 120)',
        },
        cwd: {
          type: 'string',
          description: 'Working directory for the command',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'reload_tools',
    description: 'Reload tools from the tools directory. Call this after creating or editing a tool module so Akira can use the new or updated tool without restarting.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

const handlers = {
  async execute_command(input) {
    const command = input.command || '';
    const timeout = Math.min(input.timeout || 30, 120) * 1000;
    const cwd = input.cwd;

    if (!command.trim()) {
      return { success: false, error: 'Command is required' };
    }

    // Safety check
    const { safe, pattern } = isCommandSafe(command);
    if (!safe) {
      return {
        success: false,
        error: 'Command blocked for security reasons',
        blocked_pattern: pattern,
        command,
      };
    }

    try {
      const options = {
        timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        windowsHide: true,
      };

      if (cwd) {
        options.cwd = cwd;
      }

      const { stdout, stderr } = await execPromise(command, options);

      return {
        success: true,
        stdout: stdout || '',
        stderr: stderr || '',
        return_code: 0,
        command,
      };
    } catch (error) {
      if (error.killed) {
        return {
          success: false,
          error: `Command timed out after ${timeout / 1000} seconds`,
          partial_stdout: error.stdout || '',
          partial_stderr: error.stderr || '',
          command,
        };
      }

      return {
        success: error.code === 0,
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        return_code: error.code || 1,
        error: error.message,
        command,
      };
    }
  },
};

// Add reload_tools handler
handlers.reload_tools = async function(input) {
  if (!reloadCallback) {
    return {
      success: false,
      error: 'Reload not available (no callback configured).',
    };
  }

  try {
    await reloadCallback();
    return {
      success: true,
      message: 'Tools reloaded. New tools are now available.',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || String(error),
    };
  }
};

module.exports = { definitions, handlers, setReloadCallback };
