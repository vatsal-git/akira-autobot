/**
 * Task Parser
 * Parses various task formats into structured TaskDefinition
 */

const { applyDefaults } = require('./defaults');
const { validateTask } = require('./schema');

/**
 * Parse a task from any supported format into a structured TaskDefinition
 *
 * Supported formats:
 * 1. String: "do something"
 * 2. Object with task field: { task: "do something", ... }
 * 3. Legacy format with just agent and task
 *
 * @param {string|Object} input - Task input in any format
 * @param {Object} context - Context for metadata
 * @param {string} context.fromAgent - Calling agent name
 * @param {string} context.toAgent - Target agent name
 * @param {string} [context.parentTaskId] - Parent task ID
 * @param {number} [context.depth] - Current depth
 * @returns {{ success: boolean, task: Object|null, error: string|null }}
 */
function parseTask(input, context = {}) {
  try {
    let taskDef;

    // Handle string input
    if (typeof input === 'string') {
      taskDef = { task: input };
    }
    // Handle object input
    else if (typeof input === 'object' && input !== null) {
      // If it has a 'task' field, use as-is
      if (input.task) {
        taskDef = input;
      }
      // Legacy format: might have task info in different fields
      else if (input.description || input.instruction) {
        taskDef = {
          task: input.description || input.instruction,
          ...input
        };
        delete taskDef.description;
        delete taskDef.instruction;
      }
      else {
        return {
          success: false,
          task: null,
          error: 'Object must have a "task" field'
        };
      }
    }
    else {
      return {
        success: false,
        task: null,
        error: `Invalid task type: ${typeof input}`
      };
    }

    // Validate
    const { valid, errors } = validateTask(taskDef);
    if (!valid) {
      return {
        success: false,
        task: null,
        error: errors.join(', ')
      };
    }

    // Apply defaults and metadata
    const fullTask = applyDefaults(taskDef, {
      fromAgent: context.fromAgent || 'unknown',
      toAgent: context.toAgent || 'unknown',
      parentTaskId: context.parentTaskId || null,
      depth: context.depth || 0
    });

    return {
      success: true,
      task: fullTask,
      error: null
    };

  } catch (err) {
    return {
      success: false,
      task: null,
      error: err.message
    };
  }
}

/**
 * Extract the main task string from any task format
 * Useful for logging and display
 * @param {string|Object} input - Task in any format
 * @returns {string} Main task description
 */
function extractTaskString(input) {
  if (typeof input === 'string') {
    return input;
  }
  if (typeof input === 'object' && input !== null) {
    return input.task || input.description || input.instruction || '[unknown task]';
  }
  return '[invalid task]';
}

/**
 * Format a task definition for display in prompts
 * Creates a human-readable description of the task including scope
 * @param {Object} taskDef - Parsed task definition
 * @returns {string} Formatted task description
 */
function formatTaskForPrompt(taskDef) {
  const lines = [];

  // Main task
  lines.push(`Task: ${taskDef.task}`);

  // Scope - what to do
  if (taskDef.scope?.do?.length > 0) {
    lines.push('');
    lines.push('You should:');
    taskDef.scope.do.forEach(item => lines.push(`  • ${item}`));
  }

  // Scope - what not to do
  if (taskDef.scope?.dont?.length > 0) {
    lines.push('');
    lines.push('You should NOT:');
    taskDef.scope.dont.forEach(item => lines.push(`  • ${item}`));
  }

  // Acceptable failures
  if (taskDef.scope?.acceptableFailures?.length > 0) {
    lines.push('');
    lines.push('Acceptable failures (do not treat as errors):');
    taskDef.scope.acceptableFailures.forEach(item => lines.push(`  • ${item}`));
  }

  // Output expectations
  if (taskDef.output) {
    lines.push('');
    lines.push('Output expectations:');
    lines.push(`  • Visibility: ${taskDef.output.visibility}`);
    if (taskDef.output.format !== 'text') {
      lines.push(`  • Format: ${taskDef.output.format}`);
    }
    if (taskDef.output.summaryHint) {
      lines.push(`  • Summary hint: ${taskDef.output.summaryHint}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format task metadata as a prefix string (legacy compatibility)
 * @param {Object} taskDef - Task definition with metadata
 * @returns {string} Metadata prefix string
 */
function formatMetadataPrefix(taskDef) {
  const meta = taskDef._meta || {};
  const parts = [];

  if (meta.fromAgent) {
    parts.push(`[From: ${meta.fromAgent}]`);
  }

  if (taskDef.execution?.priority && taskDef.execution.priority !== 'normal') {
    parts.push(`[Priority: ${taskDef.execution.priority.toUpperCase()}]`);
  }

  if (taskDef.output?.visibility === 'internal') {
    parts.push('[Internal]');
  } else if (taskDef.output?.visibility === 'user-summary') {
    parts.push('[Summary]');
  }

  return parts.length > 0 ? parts.join(' ') + ' ' : '';
}

/**
 * Create a minimal task representation for logging
 * @param {Object} taskDef - Task definition
 * @returns {Object} Minimal representation
 */
function toLogFormat(taskDef) {
  return {
    taskId: taskDef._meta?.taskId,
    task: taskDef.task?.substring(0, 100) + (taskDef.task?.length > 100 ? '...' : ''),
    from: taskDef._meta?.fromAgent,
    to: taskDef._meta?.toAgent,
    visibility: taskDef.output?.visibility,
    hasScope: !!(taskDef.scope?.do?.length || taskDef.scope?.dont?.length)
  };
}

module.exports = {
  parseTask,
  extractTaskString,
  formatTaskForPrompt,
  formatMetadataPrefix,
  toLogFormat
};
