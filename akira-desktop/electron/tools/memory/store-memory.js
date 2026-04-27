/**
 * Store Memory Tool
 * store_memory - Store a long-term memory for future recall
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
};

module.exports = { definitions, handlers };
