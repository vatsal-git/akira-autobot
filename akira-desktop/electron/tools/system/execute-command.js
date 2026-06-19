/**
 * Execute Command Tool (Upgraded)
 * Features: persistent cwd, background execution, real-time streaming, spawn-based
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const shellSession = require('../utils/shell-session');
const { startTask } = require('../../agents/async-task-manager');

// Event emitter for streaming output (set by main process)
let outputEmitter = null;

/**
 * Set the output emitter for streaming (called from main.js)
 * @param {Function} emitter - Function to emit output events
 */
function setOutputEmitter(emitter) {
  outputEmitter = emitter;
}

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

/**
 * Detect and handle cd commands to update session cwd
 * @param {string} command - The command string
 * @returns {boolean} - True if command was a cd that was handled
 */
function handleCdCommand(command) {
  // Match various cd patterns
  const cdPatterns = [
    /^cd\s+"([^"]+)"$/,    // cd "path with spaces"
    /^cd\s+'([^']+)'$/,    // cd 'path with spaces'
    /^cd\s+(.+)$/,         // cd path
  ];

  for (const pattern of cdPatterns) {
    const match = command.trim().match(pattern);
    if (match) {
      const targetDir = match[1].trim();
      const result = shellSession.setCwd(targetDir);
      return result;
    }
  }

  // Just "cd" goes home
  if (command.trim() === 'cd') {
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    return shellSession.setCwd(homeDir);
  }

  return null;
}

/**
 * Execute command using spawn
 * @param {string} command - Command to execute
 * @param {Object} options - Execution options
 * @returns {Promise<Object>}
 */
function executeSpawn(command, options = {}) {
  return new Promise((resolve) => {
    const { timeout = 30000, streamOutput = false } = options;

    const cwd = shellSession.getCwd();
    const env = shellSession.getEnv();

    // Determine shell based on platform
    const isWindows = process.platform === 'win32';
    const shell = isWindows ? 'cmd.exe' : '/bin/bash';
    const shellFlag = isWindows ? '/c' : '-c';

    const child = spawn(shell, [shellFlag, command], {
      cwd,
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // Set up timeout
    const timeoutId = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 1000);
    }, timeout);

    // Collect stdout
    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;

      // Stream if enabled
      if (streamOutput && outputEmitter) {
        outputEmitter({ type: 'stdout', data: chunk, command });
      }
    });

    // Collect stderr
    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Stream if enabled
      if (streamOutput && outputEmitter) {
        outputEmitter({ type: 'stderr', data: chunk, command });
      }
    });

    // Handle process exit
    child.on('close', (code) => {
      clearTimeout(timeoutId);

      // Add to history
      shellSession.addToHistory(command, code || 0);

      if (killed) {
        resolve({
          success: false,
          error: `Command timed out after ${timeout / 1000} seconds`,
          stdout,
          stderr,
          return_code: -1,
          killed: true,
          cwd
        });
      } else {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          return_code: code || 0,
          cwd
        });
      }
    });

    // Handle spawn errors
    child.on('error', (err) => {
      clearTimeout(timeoutId);
      resolve({
        success: false,
        error: `Spawn error: ${err.message}`,
        stdout,
        stderr,
        return_code: -1,
        cwd
      });
    });
  });
}

const definitions = [
  {
    name: 'execute_command',
    description: `Execute a shell command with persistent working directory. Supports background execution and output streaming. Dangerous commands (rm -rf, format, shutdown, etc.) are blocked.`,
    input_schema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The command to execute',
        },
        timeout: {
          type: 'integer',
          description: 'Timeout in seconds (default: 30, max: 300)',
        },
        cwd: {
          type: 'string',
          description: 'Override working directory (also updates session for future commands)',
        },
        run_in_background: {
          type: 'boolean',
          description: 'Run command in background, returns task_id immediately. Use await_tasks to get result.',
        },
        stream_output: {
          type: 'boolean',
          description: 'Stream stdout/stderr in real-time via events',
        },
      },
      required: ['command'],
    },
  },
  {
    name: 'get_cwd',
    description: 'Get the current working directory for command execution',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'set_cwd',
    description: 'Set the working directory for future command execution',
    input_schema: {
      type: 'object',
      properties: {
        directory: {
          type: 'string',
          description: 'Directory path (absolute or relative to current cwd)',
        },
      },
      required: ['directory'],
    },
  },
  {
    name: 'reset_shell',
    description: 'Reset shell session to defaults (cwd, env, history)',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_shell_history',
    description: 'Get recent command execution history',
    input_schema: {
      type: 'object',
      properties: {
        count: {
          type: 'integer',
          description: 'Number of recent commands to return (default: 10)',
        },
      },
      required: [],
    },
  },
];

const handlers = {
  async execute_command(input) {
    const command = input.command || '';
    const timeout = Math.min(input.timeout || 30, 300) * 1000;
    const runInBackground = input.run_in_background || false;
    const streamOutput = input.stream_output || false;

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

    // Handle cwd override
    if (input.cwd) {
      const cwdResult = shellSession.setCwd(input.cwd);
      if (!cwdResult.success) {
        return {
          success: false,
          error: `Invalid cwd: ${cwdResult.error}`,
          command,
        };
      }
    }

    // Handle pure cd commands (just update session, don't spawn)
    const cdResult = handleCdCommand(command);
    if (cdResult !== null) {
      if (cdResult.success) {
        shellSession.addToHistory(command, 0);
        return {
          success: true,
          stdout: '',
          stderr: '',
          return_code: 0,
          cwd: cdResult.cwd,
          message: `Changed directory to ${cdResult.cwd}`,
        };
      } else {
        return {
          success: false,
          error: cdResult.error,
          command,
          cwd: shellSession.getCwd(),
        };
      }
    }

    // Background execution
    if (runInBackground) {
      const { taskId } = startTask({
        name: `cmd: ${command.slice(0, 50)}${command.length > 50 ? '...' : ''}`,
        type: 'command',
        executor: () => executeSpawn(command, { timeout, streamOutput }),
        metadata: { command, cwd: shellSession.getCwd() }
      });

      return {
        success: true,
        task_id: taskId,
        message: 'Command started in background. Use await_tasks to get result.',
        cwd: shellSession.getCwd(),
      };
    }

    // Synchronous execution
    const result = await executeSpawn(command, { timeout, streamOutput });
    return {
      ...result,
      command,
    };
  },

  async get_cwd() {
    return {
      success: true,
      cwd: shellSession.getCwd(),
      state: shellSession.getState(),
    };
  },

  async set_cwd(input) {
    const { directory } = input;
    if (!directory) {
      return { success: false, error: 'Directory is required' };
    }

    const result = shellSession.setCwd(directory);
    return result;
  },

  async reset_shell() {
    return shellSession.reset();
  },

  async get_shell_history(input) {
    const count = input.count || 10;
    const history = shellSession.getHistory(count);
    return {
      success: true,
      count: history.length,
      history,
    };
  },
};

module.exports = { definitions, handlers, setOutputEmitter };
