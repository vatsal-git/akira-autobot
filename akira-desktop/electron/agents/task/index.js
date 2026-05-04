/**
 * Task Module
 * Exports all task-related utilities
 */

const schema = require('./schema');
const defaults = require('./defaults');
const builder = require('./builder');
const parser = require('./parser');

module.exports = {
  // Schema validation
  validateTask: schema.validateTask,
  hasScope: schema.hasScope,
  isInternalTask: schema.isInternalTask,
  requiresSummary: schema.requiresSummary,

  // Defaults
  DEFAULT_SCOPE: defaults.DEFAULT_SCOPE,
  DEFAULT_OUTPUT: defaults.DEFAULT_OUTPUT,
  DEFAULT_EXECUTION: defaults.DEFAULT_EXECUTION,
  generateTaskId: defaults.generateTaskId,
  createTaskMeta: defaults.createTaskMeta,
  applyDefaults: defaults.applyDefaults,
  createSimpleTask: defaults.createSimpleTask,
  createInternalTask: defaults.createInternalTask,
  createSummaryTask: defaults.createSummaryTask,

  // Builder
  TaskBuilder: builder.TaskBuilder,
  internalTask: builder.internalTask,
  summaryTask: builder.summaryTask,
  scopedTask: builder.scopedTask,

  // Parser
  parseTask: parser.parseTask,
  extractTaskString: parser.extractTaskString,
  formatTaskForPrompt: parser.formatTaskForPrompt,
  formatMetadataPrefix: parser.formatMetadataPrefix,
  toLogFormat: parser.toLogFormat
};
