/**
 * Todo Tools for Akira Orchestrator
 * Provides create_todo and update_todo tools for task tracking
 */

const {
  createTodoList,
  updateTodoItem,
  getTodoList,
  getTodoProgress
} = require('./todo-manager');

/**
 * Create todo tools for the orchestrator
 * @param {Function} onEvent - Event callback for streaming to UI
 * @returns {Object} Tool definitions and handlers
 */
function createTodoTools(onEvent) {
  const definitions = [
    {
      name: 'create_todo',
      description: `Create a todo list to track multi-step tasks visible to the user.

Use when:
- User request involves 3+ distinct steps
- Task requires coordination across multiple agents
- User explicitly asks for a plan or checklist
- Complex task where progress tracking helps

The todo list appears as an interactive checklist in the UI.`,
      input_schema: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Brief title for the task (e.g., "Set up React project")'
          },
          items: {
            type: 'array',
            description: 'List of tasks to complete',
            items: {
              type: 'object',
              properties: {
                content: {
                  type: 'string',
                  description: 'Clear description of what needs to be done'
                },
                agent: {
                  type: 'string',
                  description: 'Optional: which agent will handle this (dobby, vektor, samba, smriti, beneges)'
                }
              },
              required: ['content']
            }
          }
        },
        required: ['items']
      }
    },
    {
      name: 'update_todo',
      description: `Update the status of a todo item. Call this:
- Before delegating: set to 'in_progress'
- After agent completes: set to 'completed'
- If something fails: set to 'failed'

Optionally add a verification task to have the same agent verify their work.`,
      input_schema: {
        type: 'object',
        properties: {
          item_id: {
            type: 'string',
            description: 'ID of the item to update (from create_todo response)'
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'failed'],
            description: 'New status for the item'
          },
          add_verification: {
            type: 'object',
            description: 'Optional: add a verification task after completion',
            properties: {
              content: {
                type: 'string',
                description: 'What to verify (e.g., "Verify file was created correctly")'
              },
              agent: {
                type: 'string',
                description: 'Agent to perform verification (defaults to same agent)'
              }
            },
            required: ['content']
          }
        },
        required: ['item_id', 'status']
      }
    },
    {
      name: 'get_todo_progress',
      description: 'Get current progress of the todo list. Useful for summarizing status to user.',
      input_schema: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  ];

  const handlers = {
    create_todo(input) {
      const { title, items } = input;

      if (!items || items.length === 0) {
        return {
          success: false,
          error: 'At least one item is required'
        };
      }

      return createTodoList({ title, items, onEvent });
    },

    update_todo(input) {
      const { item_id, status, add_verification } = input;

      if (!item_id) {
        return {
          success: false,
          error: 'item_id is required'
        };
      }

      if (!['pending', 'in_progress', 'completed', 'failed'].includes(status)) {
        return {
          success: false,
          error: `Invalid status '${status}'. Must be one of: pending, in_progress, completed, failed`
        };
      }

      return updateTodoItem({
        itemId: item_id,
        status,
        addVerification: add_verification,
        onEvent
      });
    },

    get_todo_progress() {
      const progress = getTodoProgress();
      const todoList = getTodoList();

      if (!progress.hasActive) {
        return {
          success: true,
          hasActive: false,
          message: 'No active todo list'
        };
      }

      return {
        success: true,
        ...progress,
        items: todoList.items.map(item => ({
          id: item.id,
          content: item.content,
          status: item.status,
          agent: item.agent,
          verification: item.verification
        }))
      };
    }
  };

  return { definitions, handlers };
}

module.exports = { createTodoTools };
