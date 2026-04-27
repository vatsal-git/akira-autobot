/**
 * List Directory Tool
 * list_dir - List contents of a directory
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Workspace root - default to user's home directory
let WORKSPACE_ROOT = os.homedir();

function setWorkspaceRoot(root) {
  WORKSPACE_ROOT = root;
}

/**
 * Resolve and validate path stays within workspace
 */
function resolvePath(filePath) {
  if (!filePath) return null;

  // Handle absolute paths
  let resolved;
  if (path.isAbsolute(filePath)) {
    resolved = path.normalize(filePath);
  } else {
    resolved = path.normalize(path.join(WORKSPACE_ROOT, filePath));
  }

  return resolved;
}

const definitions = [
  {
    name: 'list_dir',
    description: 'List contents of a directory with name, type (file/dir), and size.',
    input_schema: {
      type: 'object',
      properties: {
        dir_path: {
          type: 'string',
          description: 'Path to the directory. Use "." or omit for current workspace.',
        },
        max_entries: {
          type: 'integer',
          description: 'Maximum entries to return (default: 200)',
        },
      },
      required: [],
    },
  },
];

const handlers = {
  async list_dir(input) {
    const dirPath = resolvePath(input.dir_path || '.');
    if (!dirPath) {
      return { success: false, error: 'Invalid directory path' };
    }

    const maxEntries = Math.min(input.max_entries || 200, 500);

    if (!fs.existsSync(dirPath)) {
      return { success: false, error: 'Path not found', path: dirPath };
    }

    const stats = fs.statSync(dirPath);
    if (!stats.isDirectory()) {
      return { success: false, error: 'Not a directory', path: dirPath };
    }

    try {
      const items = fs.readdirSync(dirPath);
      const entries = [];

      for (const name of items.slice(0, maxEntries)) {
        try {
          const itemPath = path.join(dirPath, name);
          const itemStats = fs.statSync(itemPath);
          entries.push({
            name,
            type: itemStats.isDirectory() ? 'dir' : 'file',
            size: itemStats.isFile() ? itemStats.size : null,
          });
        } catch {
          entries.push({ name, type: 'unknown', size: null });
        }
      }

      if (items.length > maxEntries) {
        entries.push({
          name: '...',
          type: 'truncated',
          note: `Limited to ${maxEntries} entries. Total: ${items.length}`,
        });
      }

      return { success: true, path: dirPath, entries };
    } catch (error) {
      return { success: false, error: error.message, path: dirPath };
    }
  },
};

module.exports = { definitions, handlers, setWorkspaceRoot };
