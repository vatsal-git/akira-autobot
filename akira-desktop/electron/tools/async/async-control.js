/**
 * Async Control Tools
 * Tools for managing parallel/async task execution
 */

const {
  awaitTasks,
  awaitAllPending,
  getPendingTasks,
  getTaskStatus
} = require('../../agents/async-task-manager');

const definitions = [
  {
    name: 'await_tasks',
    description: `Wait for specific async tasks to complete and get their results. Use this after starting tasks with run_type: "async" to collect their results before proceeding.`,
    input_schema: {
      type: 'object',
      properties: {
        task_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of task IDs to wait for. Pass empty array or omit to wait for all pending tasks.'
        },
        timeout: {
          type: 'number',
          description: 'Max time to wait in milliseconds (default: 60000)'
        }
      },
      required: []
    }
  },
  {
    name: 'get_pending_tasks',
    description: 'Get list of all currently pending or running async tasks. Use this to check what tasks are in progress before deciding to wait or start new tasks.',
    input_schema: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'Filter tasks by agent name (optional)'
        }
      },
      required: []
    }
  },
  {
    name: 'get_task_status',
    description: 'Get the status of a specific async task without waiting for it.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'The task ID to check'
        }
      },
      required: ['task_id']
    }
  }
];

const handlers = {
  async await_tasks(input) {
    const { task_ids = [], timeout = 60000 } = input;

    if (!task_ids || task_ids.length === 0) {
      // Wait for all pending tasks
      const result = await awaitAllPending();
      return {
        success: true,
        waited_for: 'all_pending',
        ...result
      };
    }

    const results = await awaitTasks(task_ids, timeout);

    // Count successes and failures
    let successCount = 0;
    let failCount = 0;
    for (const taskId of Object.keys(results)) {
      if (results[taskId].success) {
        successCount++;
      } else {
        failCount++;
      }
    }

    return {
      success: failCount === 0,
      summary: `${successCount} succeeded, ${failCount} failed`,
      results
    };
  },

  async get_pending_tasks(input) {
    const { agent = null } = input;
    const pending = getPendingTasks(agent);

    return {
      success: true,
      count: pending.length,
      tasks: pending
    };
  },

  async get_task_status(input) {
    const { task_id } = input;
    return getTaskStatus(task_id);
  }
};

module.exports = {
  definitions,
  handlers
};
