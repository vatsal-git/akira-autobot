// Test script to fetch and inspect free models from OpenRouter

async function fetchModels() {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      'HTTP-Referer': 'https://akira.app',
      'X-Title': 'Akira Desktop'
    }
  });

  if (!response.ok) {
    console.error('Failed to fetch models:', response.status);
    return;
  }

  const data = await response.json();

  // Filter for free models with tool support
  const freeModels = data.data.filter(m => {
    const isFree = m.id.includes(':free') ||
      (m.pricing?.prompt === '0' && m.pricing?.completion === '0') ||
      (m.pricing?.prompt === 0 && m.pricing?.completion === 0);
    const supportsTools = m.supported_parameters?.includes('tools') ||
      m.supported_parameters?.includes('tool_choice') ||
      m.supported_parameters?.includes('functions');
    return isFree && supportsTools;
  });

  console.log(`\n=== Found ${freeModels.length} free models with tool support ===\n`);

  // Show full info for first 3 models
  console.log('--- Sample model data (first 3 models) ---\n');
  freeModels.slice(0, 3).forEach((m, i) => {
    console.log(`\n[${i + 1}] ${m.id}`);
    console.log(JSON.stringify(m, null, 2));
  });

  // Show summary table of all models
  console.log('\n\n--- All free models summary ---\n');
  console.log('ID | context_length | max_completion_tokens | top_provider.max_completion_tokens');
  console.log('-'.repeat(120));

  freeModels.forEach(m => {
    console.log(
      `${m.id.padEnd(50)} | ` +
      `${String(m.context_length || 'N/A').padEnd(14)} | ` +
      `${String(m.max_completion_tokens || 'N/A').padEnd(21)} | ` +
      `${m.top_provider?.max_completion_tokens || 'N/A'}`
    );
  });
}

fetchModels().catch(console.error);
