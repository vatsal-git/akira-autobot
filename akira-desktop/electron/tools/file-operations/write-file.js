/**
 * Write File Tool
 * write_file - Write content to a file
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

/**
 * Check if write is allowed (block certain paths)
 */
function isWriteAllowed(filePath) {
  const blocked = ['.git', 'node_modules', 'System32', 'Windows'];
  const pathLower = filePath.toLowerCase();

  for (const b of blocked) {
    if (pathLower.includes(path.sep + b.toLowerCase() + path.sep) ||
        pathLower.endsWith(path.sep + b.toLowerCase())) {
      return { allowed: false, error: `Writing to ${b} is blocked for safety.` };
    }
  }
  return { allowed: true };
}

const definitions = [
  {
    name: 'write_file',
    description: 'Write content to a file. Creates parent directories if missing. Use append mode to add to existing file. Writes to .git/ and node_modules/ are blocked.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file (relative to workspace or absolute)',
        },
        content: {
          type: 'string',
          description: 'Content to write (hex string if mode is "binary")',
        },
        mode: {
          type: 'string',
          description: 'File mode: "text" or "binary" (default: text)',
        },
        append: {
          type: 'boolean',
          description: 'If true, append to file instead of overwriting (default: false)',
        },
        backup: {
          type: 'boolean',
          description: 'If true and overwriting existing file, create a .bak copy first (default: false)',
        },
        encoding: {
          type: 'string',
          description: 'Text encoding for text mode (default: utf-8)',
        },
      },
      required: ['file_path', 'content'],
    },
  },
];

const handlers = {
  async write_file(input) {
    const filePath = resolvePath(input.file_path);
    if (!filePath) {
      return { success: false, error: 'Invalid file path' };
    }

    const { allowed, error } = isWriteAllowed(filePath);
    if (!allowed) {
      return { success: false, error };
    }

    const content = input.content || '';
    const mode = (input.mode || 'text').toLowerCase();
    const append = input.append || false;
    const backup = input.backup || false;
    const encoding = input.encoding || 'utf-8';

    // Validate mode
    if (mode !== 'text' && mode !== 'binary') {
      return { success: false, error: `Invalid mode: ${mode}. Use 'text' or 'binary'.`, path: filePath };
    }

    try {
      // Create parent directories
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Create backup if requested and file exists
      if (backup && !append && fs.existsSync(filePath)) {
        const backupPath = filePath + '.bak';
        fs.copyFileSync(filePath, backupPath);
      }

      if (mode === 'text') {
        if (append) {
          fs.appendFileSync(filePath, content, encoding);
        } else {
          fs.writeFileSync(filePath, content, encoding);
        }
      } else {
        // Binary mode: content is hex string
        const data = Buffer.from(content, 'hex');
        if (append) {
          fs.appendFileSync(filePath, data);
        } else {
          fs.writeFileSync(filePath, data);
        }
      }

      const stats = fs.statSync(filePath);
      return {
        success: true,
        path: filePath,
        size: stats.size,
        filename: path.basename(filePath),
        append,
        mode,
      };
    } catch (error) {
      return { success: false, error: error.message, path: filePath };
    }
  },
};

module.exports = { definitions, handlers, setWorkspaceRoot };
