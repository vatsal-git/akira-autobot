/**
 * List Memories Tool
 * list_memories - List recent long-term memories
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
    name: 'list_memories',
    description: 'List recent long-term memories. Use to see what has been stored or get a quick overview.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Max number of memories to return (default: 20)',
        },
        category: {
          type: 'string',
          description: 'Filter by category (optional)',
        },
      },
      required: [],
    },
  },
];

const handlers = {
  async list_memories(input) {
    const limit = Math.min(Math.max(input.limit || 20, 1), 100);
    const category = input.category;

    let memories = loadMemories();

    // Filter by category if provided
    if (category) {
      memories = memories.filter(m => m.category === category);
    }

    // Sort by recency (newest first)
    memories.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return {
      success: true,
      memories: memories.slice(0, limit),
      count: memories.length,
    };
  },
};

module.exports = { definitions, handlers };
