/**
 * Update Memory Tool
 * update_memory - Update an existing memory's content or category
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Memory storage file location
const MEMORY_DIR = path.join(os.homedir(), '.akira');
const MEMORY_FILE = path.join(MEMORY_DIR, 'memories.json');

/**
 * Load memories from file
 */
function loadMemories() {
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
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(memories, null, 2), 'utf-8');
}

const definitions = [
  {
    name: 'update_memory',
    description: 'Update an existing memory. Use to correct or refresh outdated information instead of creating duplicates.',
    input_schema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'The ID of the memory to update',
        },
        content: {
          type: 'string',
          description: 'New content for the memory (optional, keeps existing if not provided)',
        },
        category: {
          type: 'string',
          description: 'New category for the memory (optional, keeps existing if not provided)',
        },
      },
      required: ['memory_id'],
    },
  },
];

const handlers = {
  async update_memory(input) {
    const memoryId = (input.memory_id || '').trim();
    const newContent = input.content !== undefined ? input.content.trim() : undefined;
    const newCategory = input.category !== undefined ? input.category : undefined;

    if (!memoryId) {
      return { success: false, error: 'memory_id is required' };
    }

    if (newContent === undefined && newCategory === undefined) {
      return { success: false, error: 'At least one of content or category must be provided' };
    }

    if (newContent !== undefined && newContent.length > 10000) {
      return { success: false, error: 'Memory content too long (max 10000 characters)' };
    }

    const memories = loadMemories();
    const index = memories.findIndex(m => m.id === memoryId);

    if (index === -1) {
      return { success: false, error: `Memory with ID "${memoryId}" not found` };
    }

    const memory = memories[index];
    const previousContent = memory.content;
    const previousCategory = memory.category;

    // Update fields
    if (newContent !== undefined) {
      memory.content = newContent;
    }
    if (newCategory !== undefined) {
      memory.category = newCategory;
    }
    memory.updated_at = new Date().toISOString();

    saveMemories(memories);

    return {
      success: true,
      message: 'Memory updated successfully',
      memory_id: memory.id,
      changes: {
        content: newContent !== undefined ? { from: previousContent, to: newContent } : 'unchanged',
        category: newCategory !== undefined ? { from: previousCategory, to: newCategory } : 'unchanged',
      },
    };
  },
};

module.exports = { definitions, handlers };
