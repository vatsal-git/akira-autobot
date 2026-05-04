/**
 * Async Task Manager
 * Manages parallel/async task execution with dynamic concurrency control
 */

const os = require('os');

// Task states
const TaskState = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

// Store for all tasks
const tasks = new Map();

// Running task count for concurrency control
let runningCount = 0;

// Task ID counter
let taskIdCounter = 0;

// Queue for tasks waiting due to concurrency limits
const taskQueue = [];

/**
 * Generate unique task ID
 */
function generateTaskId(prefix = 'task') {
  taskIdCounter++;
  return `${prefix}_${Date.now()}_${taskIdCounter}`;
}

/**
 * Get dynamic max concurrency based on system load
 * Keeps the app lightweight by reducing parallelism under load
 */
function getMaxConcurrency() {
  const cpuCount = os.cpus().length;
  const loadAvg = os.loadavg()[0]; // 1-minute average
  const cpuUsage = loadAvg / cpuCount;

  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memUsage = 1 - (freeMem / totalMem);

  // Heavy load - minimize parallelism
  if (cpuUsage > 0.8 || memUsage > 0.85) {
    return 2;
  }

  // Medium load - moderate parallelism
  if (cpuUsage > 0.5 || memUsage > 0.7) {
    return 4;
  }

  // Light load - allow more parallelism
  if (cpuUsage > 0.3 || memUsage > 0.5) {
    return 6;
  }

  // Very light load
  return 8;
}

/**
 * Check if we can start a new task
 */
function canStartTask() {
  return runningCount < getMaxConcurrency();
}

/**
 * Process queued tasks if capacity is available
 */
function processQueue() {
  while (taskQueue.length > 0 && canStartTask()) {
    const { taskId, executor, resolve } = taskQueue.shift();
    executeTask(taskId, executor).then(resolve);
  }
}

/**
 * Execute a task with concurrency control
 * @param {string} taskId - The task ID
 * @param {Function} executor - Async function to execute
 * @returns {Promise} - Resolves when task completes
 */
async function executeTask(taskId, executor) {
  const task = tasks.get(taskId);
  if (!task) return;

  task.state = TaskState.RUNNING;
  task.startTime = Date.now();
  runningCount++;

  try {
    const result = await executor();
    task.state = TaskState.COMPLETED;
    task.result = result;
    task.endTime = Date.now();
  } catch (error) {
    task.state = TaskState.FAILED;
    task.error = error.message || String(error);
    task.endTime = Date.now();
  } finally {
    runningCount--;
    // Process any queued tasks
    processQueue();
  }

  return task;
}

/**
 * Start an async task
 * @param {Object} options - Task options
 * @param {string} options.name - Human readable task name
 * @param {string} options.type - Task type (tool, agent, etc.)
 * @param {Function} options.executor - Async function to execute
 * @param {Object} options.metadata - Additional metadata
 * @returns {Object} - { taskId, promise }
 */
function startTask({ name, type = 'tool', executor, metadata = {} }) {
  const taskId = generateTaskId(type);

  const task = {
    id: taskId,
    name,
    type,
    state: TaskState.PENDING,
    metadata,
    createTime: Date.now(),
    startTime: null,
    endTime: null,
    result: null,
    error: null
  };

  tasks.set(taskId, task);

  // Create promise that resolves when task completes
  const promise = new Promise((resolve) => {
    if (canStartTask()) {
      // Execute immediately
      executeTask(taskId, executor).then(resolve);
    } else {
      // Queue for later execution
      taskQueue.push({ taskId, executor, resolve });
    }
  });

  // Store promise reference for awaiting
  task.promise = promise;

  return { taskId, promise };
}

/**
 * Get task by ID
 * @param {string} taskId
 * @returns {Object|null}
 */
function getTask(taskId) {
  return tasks.get(taskId) || null;
}

/**
 * Get task status
 * @param {string} taskId
 * @returns {Object}
 */
function getTaskStatus(taskId) {
  const task = tasks.get(taskId);
  if (!task) {
    return { exists: false, error: `Task ${taskId} not found` };
  }

  return {
    exists: true,
    id: task.id,
    name: task.name,
    type: task.type,
    state: task.state,
    duration: task.endTime
      ? task.endTime - task.startTime
      : (task.startTime ? Date.now() - task.startTime : null)
  };
}

/**
 * Get task result (if completed)
 * @param {string} taskId
 * @returns {Object}
 */
function getTaskResult(taskId) {
  const task = tasks.get(taskId);
  if (!task) {
    return { success: false, error: `Task ${taskId} not found` };
  }

  if (task.state === TaskState.PENDING || task.state === TaskState.RUNNING) {
    return {
      success: false,
      error: `Task ${taskId} is still ${task.state}`,
      state: task.state
    };
  }

  if (task.state === TaskState.FAILED) {
    return {
      success: false,
      error: task.error,
      state: task.state
    };
  }

  return {
    success: true,
    result: task.result,
    state: task.state,
    duration: task.endTime - task.startTime
  };
}

/**
 * Wait for specific tasks to complete
 * @param {string[]} taskIds - Array of task IDs to wait for
 * @param {number} timeout - Optional timeout in ms (default: 60000)
 * @returns {Promise<Object>} - Results keyed by taskId
 */
async function awaitTasks(taskIds, timeout = 60000) {
  const results = {};
  const startTime = Date.now();

  const promises = taskIds.map(async (taskId) => {
    const task = tasks.get(taskId);
    if (!task) {
      results[taskId] = { success: false, error: `Task ${taskId} not found` };
      return;
    }

    // If already completed, return immediately
    if (task.state === TaskState.COMPLETED || task.state === TaskState.FAILED) {
      results[taskId] = getTaskResult(taskId);
      return;
    }

    // Wait for the task promise with timeout
    try {
      await Promise.race([
        task.promise,
        new Promise((_, reject) => {
          const remaining = timeout - (Date.now() - startTime);
          if (remaining <= 0) {
            reject(new Error('Timeout'));
          } else {
            setTimeout(() => reject(new Error('Timeout')), remaining);
          }
        })
      ]);
      results[taskId] = getTaskResult(taskId);
    } catch (error) {
      results[taskId] = {
        success: false,
        error: error.message === 'Timeout'
          ? `Task ${taskId} timed out after ${timeout}ms`
          : error.message
      };
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Wait for all pending tasks from a specific agent/context
 * @param {string} agentName - Filter by agent name (optional)
 * @returns {Promise<Object>}
 */
async function awaitAllPending(agentName = null) {
  const pendingTaskIds = [];

  for (const [taskId, task] of tasks) {
    if (task.state === TaskState.PENDING || task.state === TaskState.RUNNING) {
      if (!agentName || task.metadata.agent === agentName) {
        pendingTaskIds.push(taskId);
      }
    }
  }

  if (pendingTaskIds.length === 0) {
    return { message: 'No pending tasks', results: {} };
  }

  return awaitTasks(pendingTaskIds);
}

/**
 * Get all pending tasks info
 * @param {string} agentName - Filter by agent name (optional)
 * @returns {Array}
 */
function getPendingTasks(agentName = null) {
  const pending = [];

  for (const [taskId, task] of tasks) {
    if (task.state === TaskState.PENDING || task.state === TaskState.RUNNING) {
      if (!agentName || task.metadata.agent === agentName) {
        pending.push({
          id: task.id,
          name: task.name,
          type: task.type,
          state: task.state,
          agent: task.metadata.agent,
          duration: task.startTime ? Date.now() - task.startTime : null
        });
      }
    }
  }

  return pending;
}

/**
 * Clear completed/failed tasks older than specified age
 * @param {number} maxAge - Max age in ms (default: 5 minutes)
 */
function cleanupOldTasks(maxAge = 5 * 60 * 1000) {
  const now = Date.now();

  for (const [taskId, task] of tasks) {
    if (task.state === TaskState.COMPLETED || task.state === TaskState.FAILED) {
      if (task.endTime && (now - task.endTime) > maxAge) {
        tasks.delete(taskId);
      }
    }
  }
}

/**
 * Get system stats for concurrency decisions
 */
function getSystemStats() {
  const cpuCount = os.cpus().length;
  const loadAvg = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    cpuCount,
    loadAvg: loadAvg[0],
    cpuUsage: (loadAvg[0] / cpuCount * 100).toFixed(1) + '%',
    memTotal: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
    memFree: (freeMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
    memUsage: ((1 - freeMem / totalMem) * 100).toFixed(1) + '%',
    maxConcurrency: getMaxConcurrency(),
    runningTasks: runningCount,
    queuedTasks: taskQueue.length,
    totalTasks: tasks.size
  };
}

/**
 * Cancel all pending tasks
 * Used by emergency stop to halt execution
 * @returns {Object} - Info about cancelled tasks
 */
function cancelAllPendingTasks() {
  const cancelled = [];

  // Clear the queue first
  while (taskQueue.length > 0) {
    const { taskId, resolve } = taskQueue.shift();
    const task = tasks.get(taskId);
    if (task) {
      task.state = TaskState.FAILED;
      task.error = 'Cancelled by emergency stop';
      task.endTime = Date.now();
      cancelled.push(taskId);
    }
    // Resolve with failure
    resolve?.({
      success: false,
      error: 'Task cancelled by emergency stop'
    });
  }

  // Mark running tasks as cancelled (they may still complete, but results will be ignored)
  for (const [taskId, task] of tasks) {
    if (task.state === TaskState.PENDING || task.state === TaskState.RUNNING) {
      task.state = TaskState.FAILED;
      task.error = 'Cancelled by emergency stop';
      task.endTime = Date.now();
      cancelled.push(taskId);
    }
  }

  return {
    cancelled: cancelled.length,
    taskIds: cancelled
  };
}

/**
 * Reset the task manager (for testing)
 */
function reset() {
  tasks.clear();
  taskQueue.length = 0;
  runningCount = 0;
  taskIdCounter = 0;
}

module.exports = {
  // Task states enum
  TaskState,

  // Core functions
  startTask,
  getTask,
  getTaskStatus,
  getTaskResult,

  // Await functions
  awaitTasks,
  awaitAllPending,

  // Query functions
  getPendingTasks,
  getSystemStats,
  getMaxConcurrency,

  // Control functions
  cancelAllPendingTasks,

  // Maintenance
  cleanupOldTasks,
  reset
};
