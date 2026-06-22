/**
 * Shared Prompt Sections
 * Common prompt sections used by all specialist agents
 */

/**
 * Get the structured task understanding section for agent prompts
 * @returns {string}
 */
function getStructuredTaskSection() {
  return `## Understanding Structured Tasks

You may receive tasks in a structured format with additional context:

\`\`\`
Task: Main instruction here

You should:
  • Specific action 1
  • Specific action 2

You should NOT:
  • Thing to avoid 1
  • Thing to avoid 2

Output expectations:
  • Visibility: user | internal | user-summary
  • Format: text | json | structured
\`\`\`

### Visibility Meanings
- **user**: Your full response will be shown to the user
- **internal**: Your response goes only to the calling agent (not shown to user)
- **user-summary**: A brief summary is shown to user, full data goes to calling agent

### How to Handle
1. Read the scope carefully - stay within bounds
2. If visibility is "internal", focus on data/facts rather than conversational responses
3. If you cannot complete within scope, use \`request_clarification\` or \`emergency_stop\``;
}

/**
 * Get the inter-agent communication section
 * @returns {string}
 */
function getInterAgentSection() {
  return `## Inter-Agent Communication

Your tasks include origin metadata: "[From: agent_name] [Priority: NORMAL|HIGH] [Internal|Summary]"

### Communication Tools
- **list_agents**: Discover available agents and their capabilities
- **assign_task**: Assign a task to another agent (they must execute it)
- **request_help**: Ask another agent for help (they may decline)
- **escalate_to_orchestrator**: Escalate when you need coordination or cannot handle the task
- **request_clarification**: Ask for clarification when task is ambiguous
- **emergency_stop**: Halt everything in critical situations`;
}

/**
 * Get the emergency stop section
 * @returns {string}
 */
function getEmergencyStopSection() {
  return `## Emergency Stop

Use \`emergency_stop\` when:
- Human decision is absolutely required to proceed
- You're about to perform a potentially dangerous operation
- Something is going seriously wrong
- Ethical or safety concern arises

\`\`\`javascript
emergency_stop({
  reason: "Clear explanation",
  severity: "warning|error|critical",
  requiresUserInput: true,
  suggestedActions: ["Option 1", "Option 2"],
  context: "What was happening"
})
\`\`\``;
}

/**
 * Get the clarification section
 * @returns {string}
 */
function getClarificationSection() {
  return `## Requesting Clarification

Use \`request_clarification\` when the task is ambiguous:

\`\`\`javascript
request_clarification({
  question: "Which version should I use?",
  whatIUnderstood: "You want me to update the package, but version not specified",
  options: [
    { label: "Latest stable", description: "Most recent stable release" },
    { label: "Latest beta", description: "Newest features, may have bugs" }
  ],
  canProceedWithDefault: true,
  defaultChoice: "Latest stable"
})
\`\`\`

Note: After 2 clarification requests in a task chain, further clarifications go directly to the user.`;
}

/**
 * Get the memory management instruction section
 * @returns {string}
 */
function getMemoryInstructionSection() {
  return `## Memory Management

You have access to tools for storing and searching long-term memories (\`store_memory\` and \`search_memories\`).
- **Store Reusable Info**: If any information you encounter, learn, or produce is storable or reusable (e.g. user preferences, project structure, config settings, decisions, important paths, or successful command sequences), store it using \`store_memory\`.
- **Retrieve Reusable Info**: When a task is assigned, immediately retrieve any reusable information or context that might be relevant to the task using \`search_memories\`.
- **Do Not Store Sensitive Info**: Never store API keys, passwords, credentials, or sensitive data.`;
}

/**
 * Get thinking style instructions based on level
 * @param {string} level - 'quick' | 'normal' | 'deep'
 * @returns {string}
 */
function getThinkingInstructions(level = 'normal') {
  const instructions = {
    quick: `## Thinking Style: Quick
- Think briefly and act fast
- Skip detailed analysis for simple tasks
- Only reason through genuinely complex decisions
- Prefer action over deliberation
- One short thought, then execute`,

    normal: `## Thinking Style: Normal
- Balance thinking with action
- Brief reasoning for straightforward tasks
- More thorough analysis only when complexity warrants it`,

    deep: `## Thinking Style: Deep
- Think through problems thoroughly before acting
- Consider edge cases and alternatives
- Document your reasoning process
- Verify assumptions before proceeding`
  };
  return instructions[level] || instructions.normal;
}

module.exports = {
  getStructuredTaskSection,
  getInterAgentSection,
  getEmergencyStopSection,
  getClarificationSection,
  getMemoryInstructionSection,
  getThinkingInstructions
};

