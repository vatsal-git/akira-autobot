/**
 * Task Defaults
 * Default values for task definition fields
 */

/**
 * Default scope configuration
 */
const DEFAULT_SCOPE = {
  do: [],
  dont: [],
  acceptableFailures: []
};

/**
 * Default output configuration
 */
const DEFAULT_OUTPUT = {
  visibility: 'user',
  format: 'text',
  summaryHint: null,
  maxLength: null
};

/**
 * Default execution configuration
 */
const DEFAULT_EXECUTION = {
  allowClarification: true,
  clarificationBudget: 2,
  timeout: 60000,
  retryOnFailure: false,
  priority: 'normal'
};

/**
 * Generate unique task ID
 * @returns {string}
 */
function generateTaskId() {
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create default metadata for a task
 * @param {Object} params
 * @param {string} params.fromAgent - Calling agent name
 * @param {string} params.toAgent - Target agent name
 * @param {string} [params.parentTaskId] - Parent task ID if this is a subtask
 * @param {number} [params.depth=0] - Current depth in agent chain
 * @returns {Object} Task metadata
 */
function createTaskMeta({ fromAgent, toAgent, parentTaskId = null, depth = 0 }) {
  return {
    taskId: generateTaskId(),
    fromAgent,
    toAgent,
    depth,
    createdAt: Date.now(),
    parentTaskId,
    clarificationCount: 0
  };
}

/**
 * Apply defaults to a task definition
 * Merges provided values with defaults, preserving user-specified values
 * @param {Object|string} taskDef - Task definition (or string task)
 * @param {Object} metaParams - Parameters for metadata generation
 * @returns {Object} Complete task definition with defaults applied
 */
function applyDefaults(taskDef, metaParams = {}) {
  // Handle string input
  if (typeof taskDef === 'string') {
    taskDef = { task: taskDef };
  }

  // Deep merge with defaults
  return {
    task: taskDef.task,

    scope: {
      ...DEFAULT_SCOPE,
      ...(taskDef.scope || {})
    },

    output: {
      ...DEFAULT_OUTPUT,
      ...(taskDef.output || {})
    },

    execution: {
      ...DEFAULT_EXECUTION,
      ...(taskDef.execution || {})
    },

    _meta: taskDef._meta || createTaskMeta(metaParams)
  };
}

/**
 * Create a minimal task with just the essentials
 * Used for simple string tasks
 * @param {string} task - Task description
 * @param {string} fromAgent - Calling agent
 * @param {string} toAgent - Target agent
 * @returns {Object} Minimal task definition
 */
function createSimpleTask(task, fromAgent, toAgent) {
  return {
    task,
    scope: { ...DEFAULT_SCOPE },
    output: { ...DEFAULT_OUTPUT },
    execution: { ...DEFAULT_EXECUTION },
    _meta: createTaskMeta({ fromAgent, toAgent })
  };
}

/**
 * Create an internal task (results not shown to user)
 * Convenience function for common pattern
 * @param {string} task - Task description
 * @param {Object} [scope] - Optional scope
 * @returns {Object} Task definition with internal visibility
 */
function createInternalTask(task, scope = {}) {
  return {
    task,
    scope: { ...DEFAULT_SCOPE, ...scope },
    output: {
      ...DEFAULT_OUTPUT,
      visibility: 'internal'
    },
    execution: { ...DEFAULT_EXECUTION }
  };
}

/**
 * Create a summary task (brief output shown to user)
 * @param {string} task - Task description
 * @param {string} summaryHint - Hint for generating summary
 * @param {Object} [scope] - Optional scope
 * @returns {Object} Task definition with user-summary visibility
 */
function createSummaryTask(task, summaryHint, scope = {}) {
  return {
    task,
    scope: { ...DEFAULT_SCOPE, ...scope },
    output: {
      ...DEFAULT_OUTPUT,
      visibility: 'user-summary',
      summaryHint
    },
    execution: { ...DEFAULT_EXECUTION }
  };
}

module.exports = {
  DEFAULT_SCOPE,
  DEFAULT_OUTPUT,
  DEFAULT_EXECUTION,
  generateTaskId,
  createTaskMeta,
  applyDefaults,
  createSimpleTask,
  createInternalTask,
  createSummaryTask
};
