/**
 * Todo Manager
 * Manages shared todo list state for Akira orchestrator
 */

const { EventEmitter } = require('events');

// Event emitter for todo events
const todoEmitter = new EventEmitter();

// Current todo list (session-only, no persistence)
let currentTodoList = null;

/**
 * Generate a unique ID
 */
function generateId() {
  return `todo_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new todo list
 * @param {Object} params
 * @param {string} [params.title] - Optional title for the list
 * @param {Array<{content: string, agent?: string}>} params.items - Todo items
 * @param {Function} [params.onEvent] - Event callback for streaming
 * @returns {Object} Created todo list
 */
function createTodoList({ title, items, onEvent }) {
  const listId = generateId();
  const now = Date.now();

  const todoItems = items.map((item, index) => ({
    id: `${listId}_item_${index}`,
    content: item.content,
    status: 'pending',
    agent: item.agent || null,
    verification: false,
    parentItemId: null
  }));

  currentTodoList = {
    id: listId,
    title: title || null,
    items: todoItems,
    createdAt: now,
    updatedAt: now
  };

  const eventData = {
    type: 'todo_created',
    data: { ...currentTodoList }
  };

  // Emit event for IPC forwarding
  todoEmitter.emit('todo', eventData);

  // Also call onEvent if provided (for streaming to UI)
  if (onEvent) {
    onEvent({ event: 'todo_created', data: { ...currentTodoList } });
  }

  return {
    success: true,
    todoList: currentTodoList,
    message: `Created todo list with ${todoItems.length} items`
  };
}

/**
 * Update a todo item's status
 * @param {Object} params
 * @param {string} params.itemId - ID of item to update
 * @param {string} params.status - New status
 * @param {string} [params.agent] - Agent working on this item
 * @param {Object} [params.addVerification] - Optional verification task to add
 * @param {Function} [params.onEvent] - Event callback for streaming
 * @returns {Object} Update result
 */
function updateTodoItem({ itemId, status, agent, addVerification, onEvent }) {
  if (!currentTodoList) {
    return {
      success: false,
      error: 'No active todo list. Create one first with create_todo.'
    };
  }

  const itemIndex = currentTodoList.items.findIndex(item => item.id === itemId);
  if (itemIndex === -1) {
    return {
      success: false,
      error: `Item with ID '${itemId}' not found. Available IDs: ${currentTodoList.items.map(i => i.id).join(', ')}`
    };
  }

  // Update the item
  const updates = { status };
  if (agent !== undefined) {
    updates.agent = agent;
  }

  currentTodoList.items[itemIndex] = {
    ...currentTodoList.items[itemIndex],
    ...updates
  };
  currentTodoList.updatedAt = Date.now();

  const eventData = {
    type: 'todo_updated',
    data: {
      itemId,
      updates,
      newItem: null
    }
  };

  // Add verification task if requested
  if (addVerification && addVerification.content) {
    const verificationItem = {
      id: `${itemId}_verify_${Date.now()}`,
      content: addVerification.content,
      status: 'pending',
      agent: addVerification.agent || currentTodoList.items[itemIndex].agent,
      verification: true,
      parentItemId: itemId
    };

    // Insert verification task right after the parent item
    currentTodoList.items.splice(itemIndex + 1, 0, verificationItem);
    eventData.data.newItem = verificationItem;
  }

  // Emit event
  todoEmitter.emit('todo', eventData);

  if (onEvent) {
    onEvent({ event: 'todo_updated', data: eventData.data });
  }

  return {
    success: true,
    item: currentTodoList.items[itemIndex],
    message: `Updated item '${itemId}' to status '${status}'${addVerification ? ' and added verification task' : ''}`
  };
}

/**
 * Get the current todo list
 * @returns {Object|null} Current todo list or null
 */
function getTodoList() {
  return currentTodoList;
}

/**
 * Clear the current todo list (for new session)
 */
function clearTodoList() {
  const hadList = currentTodoList !== null;
  currentTodoList = null;

  if (hadList) {
    todoEmitter.emit('todo', {
      type: 'todo_cleared',
      data: {}
    });
  }
}

/**
 * Get summary of current todo list progress
 * @returns {Object} Progress summary
 */
function getTodoProgress() {
  if (!currentTodoList) {
    return { hasActive: false };
  }

  const items = currentTodoList.items;
  const total = items.length;
  const completed = items.filter(i => i.status === 'completed').length;
  const failed = items.filter(i => i.status === 'failed').length;
  const inProgress = items.filter(i => i.status === 'in_progress').length;
  const pending = items.filter(i => i.status === 'pending').length;

  return {
    hasActive: true,
    total,
    completed,
    failed,
    inProgress,
    pending,
    percentComplete: Math.round((completed / total) * 100)
  };
}

/**
 * Subscribe to todo events
 * @param {Function} callback - Event callback
 * @returns {Function} Unsubscribe function
 */
function onTodoEvent(callback) {
  todoEmitter.on('todo', callback);
  return () => todoEmitter.off('todo', callback);
}

module.exports = {
  createTodoList,
  updateTodoItem,
  getTodoList,
  clearTodoList,
  getTodoProgress,
  onTodoEvent
};
