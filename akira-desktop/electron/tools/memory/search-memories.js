/**
 * Search Memories Tool
 * search_memories - Search long-term memories by keyword or phrase
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Memory storage file location
const MEMORY_DIR = path.join(os.homedir(), '.akira');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memories.json');

/**
 * Ensure memory directory exists
 */
function ensureMemoryDir() {
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
}

/**
 * Load memories from file
 */
function loadMemories() {
  ensureMemoryDir();
  if (!fs.existsSync(MEMORY_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(MEMORY_FILE, 'utf-8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

const definitions = [
  {
    name: 'search_memories',
    description: 'Search long-term memories by keyword or phrase. Use before answering when context about the user, project, or past decisions would help.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term or phrase to find in stored memories',
        },
        limit: {
          type: 'integer',
          description: 'Max number of memories to return (default: 20)',
        },
      },
      required: ['query'],
    },
  },
];

const handlers = {
  async search_memories(input) {
    const query = (input.query || '').trim().toLowerCase();
    const limit = Math.min(Math.max(input.limit || 20, 1), 100);

    if (!query) {
      return { success: false, error: 'Query is required' };
    }

    const memories = loadMemories();

    // Simple keyword search
    const matches = memories.filter(m => {
      const contentLower = (m.content || '').toLowerCase();
      const categoryLower = (m.category || '').toLowerCase();
      return contentLower.includes(query) || categoryLower.includes(query);
    });

    // Sort by recency (newest first)
    matches.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return {
      success: true,
      memories: matches.slice(0, limit),
      count: matches.length,
      query,
    };
  },
};

module.exports = { definitions, handlers };
