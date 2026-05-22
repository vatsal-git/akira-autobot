/**
 * Read PDF Tool
 * read_pdf - Extract text, metadata, and structure from PDF files
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const pdfParse = require('pdf-parse');

let WORKSPACE_ROOT = os.homedir();

function setWorkspaceRoot(root) {
  WORKSPACE_ROOT = root;
}

function resolvePath(filePath) {
  if (!filePath) return null;

  let resolved;
  if (path.isAbsolute(filePath)) {
    resolved = path.normalize(filePath);
  } else {
    resolved = path.normalize(path.join(WORKSPACE_ROOT, filePath));
  }

  return resolved;
}

/**
 * Analyze text content to detect potential table structures
 * Uses whitespace patterns and alignment to identify tabular data
 */
function detectTables(text) {
  const lines = text.split('\n');
  const tables = [];
  let currentTable = null;
  let tableStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const segments = line.split(/\s{2,}/).filter(s => s.trim());

    if (segments.length >= 2) {
      if (!currentTable) {
        currentTable = [];
        tableStartLine = i + 1;
      }
      currentTable.push(segments);
    } else if (currentTable && currentTable.length >= 2) {
      tables.push({
        start_line: tableStartLine,
        end_line: i,
        rows: currentTable.length,
        columns: Math.max(...currentTable.map(r => r.length)),
        preview: currentTable.slice(0, 3).map(r => r.join(' | ')).join('\n')
      });
      currentTable = null;
    } else {
      currentTable = null;
    }
  }

  if (currentTable && currentTable.length >= 2) {
    tables.push({
      start_line: tableStartLine,
      end_line: lines.length,
      rows: currentTable.length,
      columns: Math.max(...currentTable.map(r => r.length)),
      preview: currentTable.slice(0, 3).map(r => r.join(' | ')).join('\n')
    });
  }

  return tables;
}

/**
 * Detect image placeholders in PDF content
 * pdf-parse doesn't extract images, but we can note their presence
 */
function detectImagePlaceholders(pdfData) {
  const images = [];

  if (pdfData.numpages) {
    const textPerPage = pdfData.text.length / pdfData.numpages;
    for (let i = 1; i <= pdfData.numpages; i++) {
      if (textPerPage < 100) {
        images.push({
          page: i,
          note: 'Page may contain images or graphics (low text content detected)'
        });
      }
    }
  }

  return images;
}

/**
 * Extract text from specific page range
 */
function extractPageRange(text, totalPages, startPage, endPage) {
  const pageMarkers = [];
  const lines = text.split('\n');

  let avgLinesPerPage = Math.ceil(lines.length / totalPages);

  const s = Math.max(1, startPage || 1);
  const e = Math.min(totalPages, endPage || totalPages);

  const startLine = (s - 1) * avgLinesPerPage;
  const endLine = e * avgLinesPerPage;

  const extractedLines = lines.slice(startLine, endLine);

  return {
    text: extractedLines.join('\n'),
    pages_extracted: `${s}-${e}`,
    total_pages: totalPages,
    estimated: true
  };
}

const definitions = [
  {
    name: 'read_pdf',
    description: 'Extract text, metadata, and structure from a PDF file. Supports password-protected PDFs and page range selection for large files.',
    input_schema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the PDF file (absolute or relative to workspace)',
        },
        start_page: {
          type: 'integer',
          description: 'First page to extract (1-based). Use with end_page for large PDFs.',
        },
        end_page: {
          type: 'integer',
          description: 'Last page to extract (1-based, inclusive).',
        },
        password: {
          type: 'string',
          description: 'Password for protected PDFs.',
        },
        include_metadata: {
          type: 'boolean',
          description: 'Include PDF metadata (title, author, dates). Default: true',
        },
        include_structure: {
          type: 'boolean',
          description: 'Detect and report tables and image placeholders. Default: true',
        },
        max_length: {
          type: 'integer',
          description: 'Maximum text length to return (default: 100000 characters)',
        },
      },
      required: ['file_path'],
    },
  },
];

const handlers = {
  async read_pdf(input) {
    const filePath = resolvePath(input.file_path);
    if (!filePath) {
      return { success: false, error: 'Invalid file path' };
    }

    const startPage = input.start_page;
    const endPage = input.end_page;
    const password = input.password;
    const includeMetadata = input.include_metadata !== false;
    const includeStructure = input.include_structure !== false;
    const maxLength = input.max_length || 100000;

    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'File not found', path: filePath };
    }

    const ext = path.extname(filePath).toLowerCase();
    if (ext !== '.pdf') {
      return { success: false, error: 'Not a PDF file', path: filePath, extension: ext };
    }

    try {
      const dataBuffer = fs.readFileSync(filePath);
      const stats = fs.statSync(filePath);

      const options = {};
      if (password) {
        options.password = password;
      }

      let pdfData;
      try {
        pdfData = await pdfParse(dataBuffer, options);
      } catch (parseError) {
        if (parseError.message && parseError.message.includes('password')) {
          return {
            success: false,
            error: 'PDF is password protected. Please provide the password parameter.',
            path: filePath
          };
        }
        throw parseError;
      }

      const result = {
        success: true,
        path: filePath,
        filename: path.basename(filePath),
        file_size: stats.size,
        total_pages: pdfData.numpages,
      };

      if (includeMetadata) {
        result.metadata = {
          title: pdfData.info?.Title || null,
          author: pdfData.info?.Author || null,
          subject: pdfData.info?.Subject || null,
          creator: pdfData.info?.Creator || null,
          producer: pdfData.info?.Producer || null,
          creation_date: pdfData.info?.CreationDate || null,
          modification_date: pdfData.info?.ModDate || null,
          pdf_version: pdfData.version || null,
        };
      }

      let textContent = pdfData.text || '';

      if (startPage || endPage) {
        const pageData = extractPageRange(textContent, pdfData.numpages, startPage, endPage);
        textContent = pageData.text;
        result.pages_extracted = pageData.pages_extracted;
        result.extraction_note = 'Page ranges are estimated based on text distribution';
      }

      if (textContent.length > maxLength) {
        textContent = textContent.substring(0, maxLength);
        result.truncated = true;
        result.truncated_at = maxLength;
      }

      result.content = textContent;
      result.content_length = textContent.length;

      if (includeStructure) {
        result.structure = {
          tables: detectTables(textContent),
          images: detectImagePlaceholders(pdfData),
        };

        if (result.structure.tables.length > 0) {
          result.structure.tables_summary = `Found ${result.structure.tables.length} potential table(s)`;
        }
        if (result.structure.images.length > 0) {
          result.structure.images_summary = `${result.structure.images.length} page(s) may contain images`;
        }
      }

      return result;

    } catch (error) {
      return {
        success: false,
        error: error.message || String(error),
        path: filePath
      };
    }
  },
};

module.exports = { definitions, handlers, setWorkspaceRoot };
