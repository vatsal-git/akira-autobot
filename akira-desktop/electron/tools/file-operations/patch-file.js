/**
 * Patch File Tool
 * patch_file - Replace a range of lines in a text file
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
    name: 'patch_file',
    description: 'Replace a range of lines in a text file. Use after read_file to edit specific lines.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file',
        },
        start_line: {
          type: 'integer',
          description: 'First line to replace (1-based)',
        },
        end_line: {
          type: 'integer',
          description: 'Last line to replace (1-based)',
        },
        new_content: {
          type: 'string',
          description: 'Content to put in place of the range',
        },
        encoding: {
          type: 'string',
          description: 'Text encoding (default: utf-8)',
        },
      },
      required: ['file_path', 'start_line', 'end_line', 'new_content'],
    },
  },
];

const handlers = {
  async patch_file(input) {
    const filePath = resolvePath(input.file_path);
    if (!filePath) {
      return { success: false, error: 'Invalid file path' };
    }

    const { allowed, error } = isWriteAllowed(filePath);
    if (!allowed) {
      return { success: false, error };
    }

    const startLine = input.start_line;
    const endLine = input.end_line;
    const newContent = input.new_content || '';
    const encoding = input.encoding || 'utf-8';

    if (!startLine || !endLine) {
      return { success: false, error: 'start_line and end_line are required' };
    }

    if (startLine < 1 || endLine < startLine) {
      return { success: false, error: `Invalid line range: ${startLine}-${endLine}` };
    }

    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found', path: filePath };
    }

    try {
      const content = fs.readFileSync(filePath, encoding);
      const lines = content.split('\n');
      const total = lines.length;

      if (startLine > total || endLine > total) {
        return { success: false, error: `Line range ${startLine}-${endLine} exceeds file (${total} lines)` };
      }

      // Replace lines
      const before = lines.slice(0, startLine - 1);
      const after = lines.slice(endLine);
      const newLines = newContent.split('\n');

      const newFileContent = [...before, ...newLines, ...after].join('\n');
      fs.writeFileSync(filePath, newFileContent, encoding);

      return {
        success: true,
        path: filePath,
        start_line: startLine,
        end_line: endLine,
        replaced_lines: endLine - startLine + 1,
        filename: path.basename(filePath),
      };
    } catch (error) {
      return { success: false, error: error.message, path: filePath };
    }
  },
};

module.exports = { definitions, handlers, setWorkspaceRoot };
