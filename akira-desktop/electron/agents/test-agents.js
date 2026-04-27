/**
 * Test script to verify agent initialization
 * Run with: node electron/agents/test-agents.js
 */

console.log('Testing agent initialization...\n');

try {
  // Test base agent
  const { BaseAgent } = require('./base-agent');
  console.log('✓ BaseAgent loaded');

  // Test agent registry
  const registry = require('./index');
  console.log('✓ Agent registry loaded');

  // Test all specialist agents
  const { createFileAgent } = require('./specialists/file-agent');
  const fileAgent = createFileAgent();
  console.log(`✓ File Agent: ${fileAgent.toolDefinitions.length} tools - [${fileAgent.toolDefinitions.map(t => t.name).join(', ')}]`);

  const { createSystemAgent } = require('./specialists/system-agent');
  const systemAgent = createSystemAgent();
  console.log(`✓ System Agent: ${systemAgent.toolDefinitions.length} tools - [${systemAgent.toolDefinitions.map(t => t.name).join(', ')}]`);

  const { createWebAgent } = require('./specialists/web-agent');
  const webAgent = createWebAgent();
  console.log(`✓ Web Agent: ${webAgent.toolDefinitions.length} tools - [${webAgent.toolDefinitions.map(t => t.name).join(', ')}]`);

  const { createMemoryAgent } = require('./specialists/memory-agent');
  const memoryAgent = createMemoryAgent();
  console.log(`✓ Memory Agent: ${memoryAgent.toolDefinitions.length} tools - [${memoryAgent.toolDefinitions.map(t => t.name).join(', ')}]`);

  const { createDesktopAgent } = require('./specialists/desktop-agent');
  const desktopAgent = createDesktopAgent();
  console.log(`✓ Desktop Agent: ${desktopAgent.toolDefinitions.length} tools - [${desktopAgent.toolDefinitions.map(t => t.name).join(', ')}]`);

  // Test orchestrator
  const { createOrchestratorAgent } = require('./orchestrator');
  const orchestrator = createOrchestratorAgent();
  console.log(`✓ Orchestrator Agent loaded`);

  // Test full initialization
  const { initializeAgents, getAvailableAgents } = require('./init');
  initializeAgents({ apiKey: 'test', model: 'test', temperature: 0.7 });

  const agents = getAvailableAgents();
  console.log(`\n✓ All ${agents.length} agents initialized successfully:`);
  agents.forEach(a => {
    console.log(`  - ${a.name} (${a.displayName}): ${a.tools.length} tools`);
  });

  console.log('\n✅ All tests passed!');

} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error(error.stack);
  process.exit(1);
}
