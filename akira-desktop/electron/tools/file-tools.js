/**
 * File Management Tools
 * read_file, write_file, list_dir, patch_file
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

// Tool definitions
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

// Tool handlers
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
