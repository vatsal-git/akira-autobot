/**
 * Delete Memory Tool
 * delete_memory - Remove a memory by ID
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
    name: 'delete_memory',
    description: 'Delete a memory by its ID. Use when a memory is outdated, incorrect, or no longer relevant.',
    input_schema: {
      type: 'object',
      properties: {
        memory_id: {
          type: 'string',
          description: 'The ID of the memory to delete',
        },
      },
      required: ['memory_id'],
    },
  },
];

const handlers = {
  async delete_memory(input) {
    const memoryId = (input.memory_id || '').trim();

    if (!memoryId) {
      return { success: false, error: 'memory_id is required' };
    }

    const memories = loadMemories();
    const index = memories.findIndex(m => m.id === memoryId);

    if (index === -1) {
      return { success: false, error: `Memory with ID "${memoryId}" not found` };
    }

    const deleted = memories.splice(index, 1)[0];
    saveMemories(memories);

    return {
      success: true,
      message: 'Memory deleted successfully',
      deleted_memory: {
        id: deleted.id,
        content: deleted.content,
        category: deleted.category,
      },
    };
  },
};

module.exports = { definitions, handlers };
