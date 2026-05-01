/**
 * Task Builder
 * Fluent API for building structured task definitions
 */

const { applyDefaults, createTaskMeta } = require('./defaults');
const { validateTask } = require('./schema');

/**
 * TaskBuilder provides a fluent interface for creating task definitions
 *
 * @example
 * const task = TaskBuilder
 *   .create("Search for React tutorials")
 *   .shouldDo(["Search recent articles", "Find official docs"])
 *   .shouldNotDo(["Include paid content"])
 *   .outputTo("internal")
 *   .withFormat("json")
 *   .build();
 */
class TaskBuilder {
  constructor(task) {
    this._task = {
      task: task,
      scope: {
        do: [],
        dont: [],
        acceptableFailures: []
      },
      output: {
        visibility: 'user',
        format: 'text',
        summaryHint: null,
        maxLength: null
      },
      execution: {
        allowClarification: true,
        clarificationBudget: 2,
        timeout: 60000,
        retryOnFailure: false,
        priority: 'normal'
      }
    };
  }

  /**
   * Create a new TaskBuilder
   * @param {string} task - Main task description
   * @returns {TaskBuilder}
   */
  static create(task) {
    return new TaskBuilder(task);
  }

  /**
   * Set specific actions the agent should take
   * @param {string[]} actions - List of actions to perform
   * @returns {TaskBuilder}
   */
  shouldDo(actions) {
    this._task.scope.do = Array.isArray(actions) ? actions : [actions];
    return this;
  }

  /**
   * Add a single action to the "do" list
   * @param {string} action - Action to add
   * @returns {TaskBuilder}
   */
  addDo(action) {
    this._task.scope.do.push(action);
    return this;
  }

  /**
   * Set actions the agent should NOT take
   * @param {string[]} actions - List of actions to avoid
   * @returns {TaskBuilder}
   */
  shouldNotDo(actions) {
    this._task.scope.dont = Array.isArray(actions) ? actions : [actions];
    return this;
  }

  /**
   * Add a single action to the "dont" list
   * @param {string} action - Action to avoid
   * @returns {TaskBuilder}
   */
  addDont(action) {
    this._task.scope.dont.push(action);
    return this;
  }

  /**
   * Set acceptable failure conditions
   * @param {string[]} failures - Failures that are OK
   * @returns {TaskBuilder}
   */
  acceptFailures(failures) {
    this._task.scope.acceptableFailures = Array.isArray(failures) ? failures : [failures];
    return this;
  }

  /**
   * Set output visibility
   * @param {'user' | 'internal' | 'user-summary'} visibility
   * @returns {TaskBuilder}
   */
  outputTo(visibility) {
    this._task.output.visibility = visibility;
    return this;
  }

  /**
   * Shorthand for outputTo('internal')
   * @returns {TaskBuilder}
   */
  internal() {
    return this.outputTo('internal');
  }

  /**
   * Shorthand for outputTo('user-summary') with hint
   * @param {string} hint - Summary generation hint
   * @returns {TaskBuilder}
   */
  summarize(hint) {
    this._task.output.visibility = 'user-summary';
    this._task.output.summaryHint = hint;
    return this;
  }

  /**
   * Set output format
   * @param {'text' | 'json' | 'structured'} format
   * @returns {TaskBuilder}
   */
  withFormat(format) {
    this._task.output.format = format;
    return this;
  }

  /**
   * Set summary hint (used when visibility is 'user-summary')
   * @param {string} hint
   * @returns {TaskBuilder}
   */
  withSummaryHint(hint) {
    this._task.output.summaryHint = hint;
    return this;
  }

  /**
   * Set max output length
   * @param {number} length
   * @returns {TaskBuilder}
   */
  maxLength(length) {
    this._task.output.maxLength = length;
    return this;
  }

  /**
   * Allow or disallow clarification requests
   * @param {boolean} allow
   * @returns {TaskBuilder}
   */
  allowClarification(allow = true) {
    this._task.execution.allowClarification = allow;
    return this;
  }

  /**
   * Set max clarifications before auto-escalate
   * @param {number} budget
   * @returns {TaskBuilder}
   */
  clarificationBudget(budget) {
    this._task.execution.clarificationBudget = budget;
    return this;
  }

  /**
   * Set task timeout
   * @param {number} ms - Timeout in milliseconds
   * @returns {TaskBuilder}
   */
  timeout(ms) {
    this._task.execution.timeout = ms;
    return this;
  }

  /**
   * Enable retry on transient failures
   * @param {boolean} retry
   * @returns {TaskBuilder}
   */
  retryOnFailure(retry = true) {
    this._task.execution.retryOnFailure = retry;
    return this;
  }

  /**
   * Set task priority
   * @param {'normal' | 'high' | 'critical'} priority
   * @returns {TaskBuilder}
   */
  priority(priority) {
    this._task.execution.priority = priority;
    return this;
  }

  /**
   * Shorthand for priority('high')
   * @returns {TaskBuilder}
   */
  highPriority() {
    return this.priority('high');
  }

  /**
   * Shorthand for priority('critical')
   * @returns {TaskBuilder}
   */
  critical() {
    return this.priority('critical');
  }

  /**
   * Add metadata (usually auto-populated, but can be set manually)
   * @param {Object} meta
   * @returns {TaskBuilder}
   */
  withMeta(meta) {
    this._task._meta = meta;
    return this;
  }

  /**
   * Build and validate the task definition
   * @param {Object} [metaParams] - Optional metadata params (fromAgent, toAgent, etc.)
   * @returns {Object} Complete task definition
   * @throws {Error} If validation fails
   */
  build(metaParams = {}) {
    const { valid, errors } = validateTask(this._task);

    if (!valid) {
      throw new Error(`Invalid task definition: ${errors.join(', ')}`);
    }

    // Apply metadata if not already set
    if (!this._task._meta && (metaParams.fromAgent || metaParams.toAgent)) {
      this._task._meta = createTaskMeta(metaParams);
    }

    return { ...this._task };
  }

  /**
   * Build without validation (use with caution)
   * @returns {Object} Task definition
   */
  buildUnsafe() {
    return { ...this._task };
  }

  /**
   * Get the task object for spreading into delegate_agent call
   * Returns just the task-relevant fields (excludes _meta)
   * @returns {Object}
   */
  toTaskParams() {
    const { _meta, ...taskParams } = this.build();
    return taskParams;
  }
}

/**
 * Quick helper functions for common patterns
 */

/**
 * Create a simple internal task
 * @param {string} task - Task description
 * @returns {Object} Task definition
 */
function internalTask(task) {
  return TaskBuilder.create(task).internal().build();
}

/**
 * Create a task with summary output
 * @param {string} task - Task description
 * @param {string} hint - Summary hint
 * @returns {Object} Task definition
 */
function summaryTask(task, hint) {
  return TaskBuilder.create(task).summarize(hint).build();
}

/**
 * Create a scoped task
 * @param {string} task - Task description
 * @param {string[]} doList - Things to do
 * @param {string[]} dontList - Things not to do
 * @returns {Object} Task definition
 */
function scopedTask(task, doList, dontList) {
  return TaskBuilder.create(task)
    .shouldDo(doList)
    .shouldNotDo(dontList)
    .build();
}

module.exports = {
  TaskBuilder,
  internalTask,
  summaryTask,
  scopedTask
};
