/**
 * Task Schema Definition
 * Defines the structure for inter-agent task communication
 */

/**
 * Visibility options for task output
 * @typedef {'user' | 'internal' | 'user-summary'} OutputVisibility
 * - user: Full output shown to user in chat
 * - internal: Output returned to calling agent only, not shown to user
 * - user-summary: Brief summary shown to user, full data to calling agent
 */

/**
 * Output format options
 * @typedef {'text' | 'json' | 'structured'} OutputFormat
 */

/**
 * Task priority levels
 * @typedef {'normal' | 'high' | 'critical'} TaskPriority
 */

/**
 * Task scope definition
 * @typedef {Object} TaskScope
 * @property {string[]} [do] - Specific actions the agent should take
 * @property {string[]} [dont] - Actions explicitly out of scope
 * @property {string[]} [acceptableFailures] - Failures that are OK (won't trigger error)
 */

/**
 * Task output configuration
 * @typedef {Object} TaskOutput
 * @property {OutputVisibility} [visibility='user'] - Who sees the output
 * @property {OutputFormat} [format='text'] - Expected output format
 * @property {string} [summaryHint] - Hint for generating user-summary
 * @property {number} [maxLength] - Optional cap on response length
 */

/**
 * Task execution configuration
 * @typedef {Object} TaskExecution
 * @property {boolean} [allowClarification=true] - Can agent ask for clarification
 * @property {number} [clarificationBudget=2] - Max clarifications before auto-escalate
 * @property {number} [timeout=60000] - Timeout in milliseconds
 * @property {boolean} [retryOnFailure=false] - Auto-retry transient failures
 * @property {TaskPriority} [priority='normal'] - Task priority level
 */

/**
 * Task metadata (auto-populated)
 * @typedef {Object} TaskMeta
 * @property {string} taskId - Unique task identifier
 * @property {string} fromAgent - Agent that created this task
 * @property {string} toAgent - Target agent
 * @property {number} depth - Nesting level in agent chain
 * @property {number} createdAt - Timestamp
 * @property {string|null} parentTaskId - Parent task for chains
 * @property {number} clarificationCount - Number of clarifications so far
 */

/**
 * Complete task definition
 * @typedef {Object} TaskDefinition
 * @property {string} task - Main instruction (required)
 * @property {TaskScope} [scope] - Scope boundaries
 * @property {TaskOutput} [output] - Output configuration
 * @property {TaskExecution} [execution] - Execution configuration
 * @property {TaskMeta} [_meta] - Auto-populated metadata
 */

/**
 * Validate a task definition
 * @param {TaskDefinition|string} taskDef - Task to validate
 * @returns {{ valid: boolean, errors: string[], normalized: TaskDefinition }}
 */
function validateTask(taskDef) {
  const errors = [];

  // Handle string input
  if (typeof taskDef === 'string') {
    return {
      valid: true,
      errors: [],
      normalized: { task: taskDef }
    };
  }

  // Must be an object
  if (!taskDef || typeof taskDef !== 'object') {
    return {
      valid: false,
      errors: ['Task must be a string or object'],
      normalized: null
    };
  }

  // Required: task field
  if (!taskDef.task || typeof taskDef.task !== 'string') {
    errors.push('Task must have a "task" field (string)');
  }

  // Validate scope if present
  if (taskDef.scope) {
    if (typeof taskDef.scope !== 'object') {
      errors.push('scope must be an object');
    } else {
      if (taskDef.scope.do && !Array.isArray(taskDef.scope.do)) {
        errors.push('scope.do must be an array');
      }
      if (taskDef.scope.dont && !Array.isArray(taskDef.scope.dont)) {
        errors.push('scope.dont must be an array');
      }
      if (taskDef.scope.acceptableFailures && !Array.isArray(taskDef.scope.acceptableFailures)) {
        errors.push('scope.acceptableFailures must be an array');
      }
    }
  }

  // Validate output if present
  if (taskDef.output) {
    if (typeof taskDef.output !== 'object') {
      errors.push('output must be an object');
    } else {
      const validVisibility = ['user', 'internal', 'user-summary'];
      if (taskDef.output.visibility && !validVisibility.includes(taskDef.output.visibility)) {
        errors.push(`output.visibility must be one of: ${validVisibility.join(', ')}`);
      }
      const validFormats = ['text', 'json', 'structured'];
      if (taskDef.output.format && !validFormats.includes(taskDef.output.format)) {
        errors.push(`output.format must be one of: ${validFormats.join(', ')}`);
      }
    }
  }

  // Validate execution if present
  if (taskDef.execution) {
    if (typeof taskDef.execution !== 'object') {
      errors.push('execution must be an object');
    } else {
      const validPriorities = ['normal', 'high', 'critical'];
      if (taskDef.execution.priority && !validPriorities.includes(taskDef.execution.priority)) {
        errors.push(`execution.priority must be one of: ${validPriorities.join(', ')}`);
      }
      if (taskDef.execution.timeout && typeof taskDef.execution.timeout !== 'number') {
        errors.push('execution.timeout must be a number');
      }
      if (taskDef.execution.clarificationBudget && typeof taskDef.execution.clarificationBudget !== 'number') {
        errors.push('execution.clarificationBudget must be a number');
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    normalized: errors.length === 0 ? taskDef : null
  };
}

/**
 * Check if a task definition has scope defined
 * @param {TaskDefinition} taskDef
 * @returns {boolean}
 */
function hasScope(taskDef) {
  return !!(taskDef.scope && (
    (taskDef.scope.do && taskDef.scope.do.length > 0) ||
    (taskDef.scope.dont && taskDef.scope.dont.length > 0)
  ));
}

/**
 * Check if visibility is internal (not shown to user)
 * @param {TaskDefinition} taskDef
 * @returns {boolean}
 */
function isInternalTask(taskDef) {
  return taskDef.output?.visibility === 'internal';
}

/**
 * Check if task requires user summary
 * @param {TaskDefinition} taskDef
 * @returns {boolean}
 */
function requiresSummary(taskDef) {
  return taskDef.output?.visibility === 'user-summary';
}

module.exports = {
  validateTask,
  hasScope,
  isInternalTask,
  requiresSummary
};
