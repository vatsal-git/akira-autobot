/**
 * Shell Session Manager
 * Maintains persistent state (cwd, env) across command executions
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Singleton session state
const session = {
  cwd: process.cwd(),
  env: { ...process.env },
  history: [],
  maxHistory: 100
};

/**
 * Get current working directory
 */
function getCwd() {
  return session.cwd;
}

/**
 * Set working directory with validation
 * @param {string} dir - New directory path (absolute or relative to current cwd)
 * @returns {{ success: boolean, cwd?: string, error?: string }}
 */
function setCwd(dir) {
  if (!dir || typeof dir !== 'string') {
    return { success: false, error: 'Directory path is required' };
  }

  // Handle home directory shortcut
  let targetDir = dir;
  if (targetDir === '~' || targetDir.startsWith('~/')) {
    targetDir = targetDir.replace(/^~/, os.homedir());
  }

  // Resolve relative to current cwd
  const resolvedDir = path.resolve(session.cwd, targetDir);

  // Validate directory exists
  try {
    const stats = fs.statSync(resolvedDir);
    if (!stats.isDirectory()) {
      return { success: false, error: `Not a directory: ${resolvedDir}` };
    }
  } catch (err) {
    return { success: false, error: `Directory not found: ${resolvedDir}` };
  }

  session.cwd = resolvedDir;
  return { success: true, cwd: resolvedDir };
}

/**
 * Get environment variables
 */
function getEnv() {
  return { ...session.env };
}

/**
 * Set an environment variable
 * @param {string} key - Variable name
 * @param {string} value - Variable value (null to unset)
 */
function setEnv(key, value) {
  if (!key || typeof key !== 'string') {
    return { success: false, error: 'Variable name is required' };
  }

  if (value === null || value === undefined) {
    delete session.env[key];
    return { success: true, action: 'unset', key };
  }

  session.env[key] = String(value);
  return { success: true, action: 'set', key, value: session.env[key] };
}

/**
 * Add command to history
 * @param {string} command - Executed command
 * @param {number} exitCode - Command exit code
 */
function addToHistory(command, exitCode = 0) {
  session.history.push({
    command,
    exitCode,
    cwd: session.cwd,
    timestamp: Date.now()
  });

  // Trim history if too long
  if (session.history.length > session.maxHistory) {
    session.history = session.history.slice(-session.maxHistory);
  }
}

/**
 * Get command history
 * @param {number} count - Number of recent entries to return
 */
function getHistory(count = 10) {
  return session.history.slice(-count);
}

/**
 * Reset session to defaults
 */
function reset() {
  session.cwd = process.cwd();
  session.env = { ...process.env };
  session.history = [];
  return { success: true, cwd: session.cwd };
}

/**
 * Get full session state (for debugging)
 */
function getState() {
  return {
    cwd: session.cwd,
    envCount: Object.keys(session.env).length,
    historyCount: session.history.length
  };
}

module.exports = {
  getCwd,
  setCwd,
  getEnv,
  setEnv,
  addToHistory,
  getHistory,
  reset,
  getState
};
