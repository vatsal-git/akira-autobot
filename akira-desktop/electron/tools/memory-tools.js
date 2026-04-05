/**
 * Memory Management Tools
 * store_memory, search_memories, list_memories
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

/**
 * Save memories to file
 */
function saveMemories(memories) {
  ensureMemoryDir();
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2), 'utf-8');
}

/**
 * Generate simple ID
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

const definitions = [
  {
    name: 'store_memory',
    description: 'Store a long-term memory for future recall. Use when the user shares something worth remembering: preferences, facts, project context, or decisions.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The memory to store (e.g. "User prefers dark mode", "Project uses React 18")',
        },
        category: {
          type: 'string',
          description: 'Optional category/tag (e.g. "preferences", "project", "user")',
        },
      },
      required: ['content'],
    },
  },
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
  async store_memory(input) {
    const content = (input.content || '').trim();
    const category = input.category || null;

    if (!content) {
      return { success: false, error: 'Content is required' };
    }

    if (content.length > 10000) {
      return { success: false, error: 'Memory content too long (max 10000 characters)' };
    }

    const memories = loadMemories();

    const memory = {
      id: generateId(),
      content,
      category,
      created_at: new Date().toISOString(),
    };

    memories.push(memory);
    saveMemories(memories);

    return {
      success: true,
      memory_id: memory.id,
      message: 'Memory stored successfully',
    };
  },

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
