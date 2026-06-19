/**
 * Agent Capability Manifest
 * Defines what each agent can and cannot do
 */

const AGENT_CAPABILITIES = {
  dobby: {
    name: 'dobby',
    displayName: 'Dobby',
    summary: 'File system operations: read, write, patch files and list directories',

    capabilities: [
      {
        action: 'read',
        description: 'Read file contents with optional line ranges',
        supports: ['text files', 'JSON', 'code files', 'config files', 'markdown'],
        limitations: ['Max ~10MB file size', 'Text files only (no binary)']
      },
      {
        action: 'write',
        description: 'Create new files or overwrite existing ones',
        supports: ['any text format', 'JSON', 'code', 'config'],
        limitations: ['Cannot write binary files', 'Workspace directory only']
      },
      {
        action: 'patch',
        description: 'Make targeted edits to existing files using search-replace',
        supports: ['search-replace edits', 'line-based modifications'],
        limitations: ['File must exist', 'Text files only']
      },
      {
        action: 'list',
        description: 'List directory contents with optional recursion',
        supports: ['recursive listing', 'file filtering', 'metadata'],
        limitations: ['Max 1000 entries', 'Workspace only']
      }
    ],

    cannotDo: [
      'Execute or run files',
      'Access files outside workspace',
      'Handle binary files (images, videos, executables)',
      'Network or web operations',
      'System commands or shell operations'
    ],

    bestFor: [
      'Reading configuration files',
      'Writing code or text files',
      'Modifying existing source code',
      'Exploring project structure',
      'Creating new files from scratch'
    ],

    notFor: [
      'Running code or scripts (use Vektor)',
      'Downloading files from web (use Samba)',
      'UI automation or screenshots (use BeneGes)',
      'Storing memories (handled by Akira)'
    ],

    exampleTasks: [
      'Read the package.json file',
      'Create a new config file with these settings',
      'Update the API endpoint in config.js',
      'List all JavaScript files in src/'
    ]
  },

  samba: {
    name: 'samba',
    displayName: 'Samba',
    summary: 'Web search and content fetching from URLs',

    capabilities: [
      {
        action: 'search',
        description: 'Search the internet for information',
        supports: ['general queries', 'technical questions', 'recent information'],
        limitations: ['Results depend on search provider', 'May not find very recent info']
      },
      {
        action: 'fetch',
        description: 'Fetch and extract content from web URLs',
        supports: ['HTML pages', 'text content', 'article extraction'],
        limitations: ['Some sites block bots', 'No JavaScript rendering', 'No authentication']
      }
    ],

    cannotDo: [
      'Download large files or binaries',
      'Access authenticated/login-required pages',
      'Interact with web pages (clicking, form filling)',
      'Render JavaScript-heavy pages',
      'Save files locally (needs Dobby)'
    ],

    bestFor: [
      'Searching for documentation',
      'Finding code examples',
      'Getting current information',
      'Fetching article content',
      'Looking up error messages'
    ],

    notFor: [
      'Downloading files to disk (use Dobby after)',
      'Browser automation (use BeneGes)',
      'Running web-related commands (use Vektor)',
      'Saving search results (use Dobby)'
    ],

    exampleTasks: [
      'Search for React 18 migration guide',
      'Fetch the content from this URL',
      'Find documentation for lodash debounce',
      'Search for solutions to this error message'
    ]
  },

  vektor: {
    name: 'vektor',
    displayName: 'Vektor',
    summary: 'Execute shell commands with persistent cwd, background execution, and streaming',

    capabilities: [
      {
        action: 'execute',
        description: 'Run shell commands with persistent working directory',
        supports: ['CLI commands', 'scripts', 'system utilities', 'package managers', 'background execution', 'output streaming'],
        limitations: ['No GUI commands', 'Timeout max 300s', 'Dangerous commands blocked']
      },
      {
        action: 'shell_session',
        description: 'Manage shell session state (cwd, history)',
        supports: ['get/set working directory', 'command history', 'session reset'],
        limitations: ['Session resets on app restart']
      },
      {
        action: 'background_tasks',
        description: 'Run long commands asynchronously',
        supports: ['run_in_background mode', 'await_tasks for results', 'task status checking'],
        limitations: ['Must await to get results']
      },
      {
        action: 'process',
        description: 'Manage and inspect processes',
        supports: ['list processes', 'check status', 'environment variables'],
        limitations: ['Cannot terminate system processes', 'Limited admin access']
      }
    ],

    cannotDo: [
      'Modify system configuration without permission',
      'Delete system files',
      'Install software without confirmation',
      'Access sensitive data without permission',
      'Run GUI applications (use BeneGes)',
      'Read/write file contents directly (use Dobby)'
    ],

    bestFor: [
      'Running npm/yarn commands',
      'Git operations',
      'Building projects (can run in background)',
      'Running tests',
      'Long-running commands (npm install, builds)',
      'Navigating directories (cd persists)',
      'Checking system information'
    ],

    notFor: [
      'Reading file contents (use Dobby)',
      'Web searches (use Samba)',
      'GUI automation (use BeneGes)',
      'Long-term storage (handled by Akira)'
    ],

    exampleTasks: [
      'Run npm install in background',
      'Navigate to src/ and list files',
      'Execute git status',
      'Build the project with npm run build',
      'Check command history'
    ]
  },

  beneges: {
    name: 'beneges',
    displayName: 'BeneGes',
    summary: 'Desktop automation: mouse, keyboard, screenshots, UI interaction',

    capabilities: [
      {
        action: 'mouse',
        description: 'Mouse operations: click, double-click, right-click, move, drag, scroll',
        supports: ['clicking', 'dragging', 'scrolling', 'positioning'],
        limitations: ['Requires screen coordinates', 'Cannot click outside visible screen']
      },
      {
        action: 'keyboard',
        description: 'Keyboard input: typing, key presses, shortcuts',
        supports: ['text input', 'key combinations', 'special keys'],
        limitations: ['Requires focused window', 'No clipboard access']
      },
      {
        action: 'screenshot',
        description: 'Capture screenshots and analyze screen content',
        supports: ['full screen', 'screen query'],
        limitations: ['Cannot capture specific windows only']
      },
      {
        action: 'ui_parse',
        description: 'OCR-based text detection to find UI elements',
        supports: ['text elements', 'labels', 'buttons with text'],
        limitations: ['TEXT ONLY - cannot detect icons or images', 'Accuracy varies']
      },
      {
        action: 'windows_uia',
        description: 'Windows UI Automation for accessibility-based interaction',
        supports: ['non-text elements', 'structured UI trees', 'automation patterns'],
        limitations: ['Windows only', 'Not all apps support UIA']
      }
    ],

    cannotDo: [
      'Automate sensitive operations (banking, admin consoles)',
      'Access clipboard content',
      'Capture audio or video streams',
      'Interact with minimized windows',
      'Run in background without visible screen'
    ],

    bestFor: [
      'Clicking buttons and UI elements',
      'Typing into applications',
      'Taking screenshots for verification',
      'Automating repetitive GUI tasks',
      'Finding text on screen'
    ],

    notFor: [
      'File operations (use Dobby)',
      'Web scraping (use Samba for content)',
      'Running CLI commands (use Vektor)',
      'Storing automation steps (handled by Akira)'
    ],

    exampleTasks: [
      'Click the Start button',
      'Take a screenshot of the current screen',
      'Type this text into the active window',
      'Find and click the Submit button'
    ]
  },
};

/**
 * Get capability manifest for a specific agent
 * @param {string} agentName
 * @returns {Object|null}
 */
function getAgentCapabilities(agentName) {
  return AGENT_CAPABILITIES[agentName] || null;
}

/**
 * Get all agent capabilities
 * @returns {Object}
 */
function getAllCapabilities() {
  return { ...AGENT_CAPABILITIES };
}

/**
 * Get agent names
 * @returns {string[]}
 */
function getAgentNames() {
  return Object.keys(AGENT_CAPABILITIES);
}

module.exports = {
  AGENT_CAPABILITIES,
  getAgentCapabilities,
  getAllCapabilities,
  getAgentNames
};
