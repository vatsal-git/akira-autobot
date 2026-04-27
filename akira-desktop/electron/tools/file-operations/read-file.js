/**
 * Read File Tool
 * read_file - Read content from a file
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

  // Security: ensure path doesn't escape workspace (optional, can be disabled)
  // For desktop app, we allow full filesystem access
  return resolved;
}

const definitions = [
  {
    name: 'read_file',
    description: 'Read content from a file. Use absolute paths or relative paths from workspace. For large files, use start_line and end_line to read a range.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the file (absolute or relative to workspace)',
        },
        start_line: {
          type: 'integer',
          description: 'First line to read (1-based, inclusive). Use with end_line for large files.',
        },
        end_line: {
          type: 'integer',
          description: 'Last line to read (1-based, inclusive).',
        },
        encoding: {
          type: 'string',
          description: 'Text encoding (default: utf-8).',
        },
        include_line_numbers: {
          type: 'boolean',
          description: 'Prepend line numbers to each line (default: true).',
        },
      },
      required: ['file_path'],
    },
  },
];

const handlers = {
  async read_file(input) {
    const filePath = resolvePath(input.file_path);
    if (!filePath) {
      return { success: false, error: 'Invalid file path' };
    }

    const startLine = input.start_line;
    const endLine = input.end_line;
    const encoding = input.encoding || 'utf-8';
    const includeLineNumbers = input.include_line_numbers !== false;

    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found', path: filePath };
    }

    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      return { success: false, error: 'Not a file', path: filePath };
    }

    try {
      const content = fs.readFileSync(filePath, encoding);
      const lines = content.split('\n');
      const totalLines = lines.length;

      let outputLines = lines;
      let lineInfo = { total_lines: totalLines };

      if (startLine != null || endLine != null) {
        const s = Math.max(1, startLine || 1);
        const e = Math.min(totalLines, endLine || totalLines);
        if (s > e) {
          return { success: false, error: `start_line (${s}) must be <= end_line (${e})` };
        }
        outputLines = lines.slice(s - 1, e);
        lineInfo = { start_line: s, end_line: e, total_lines: totalLines };
      } else if (stats.size > 500000) {
        // Large file warning
        return {
          success: false,
          error: `File is large (${stats.size} bytes, ${totalLines} lines). Use start_line and end_line.`,
          size: stats.size,
          total_lines: totalLines,
        };
      }

      let outputContent;
      if (includeLineNumbers) {
        const base = (startLine || 1);
        outputContent = outputLines.map((line, i) => `${base + i}|${line}`).join('\n');
      } else {
        outputContent = outputLines.join('\n');
      }

      return {
        success: true,
        content: outputContent,
        size: stats.size,
        path: filePath,
        filename: path.basename(filePath),
        ...lineInfo,
      };
    } catch (error) {
      return { success: false, error: error.message, path: filePath };
    }
  },
};

module.exports = { definitions, handlers, setWorkspaceRoot };
