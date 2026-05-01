/**
 * Web Search Tool
 * web_search - Search the web using DuckDuckGo
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');
const { startTask } = require('../../agents/async-task-manager');

/**
 * Simple HTML to text conversion
 */
function htmlToText(html) {
  // Remove script and style elements
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Replace block elements with newlines
  text = text.replace(/<\/(div|p|h1|h2|h3|h4|h5|h6|article|section|main|br)>/gi, '\n');

  // Remove all other HTML tags
  text = text.replace(/<[^>]*>/g, '');

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text.replace(/\n\s*\n/g, '\n\n');
  text = text.replace(/[ \t]+/g, ' ');

  return text.trim();
}

/**
 * Make HTTP/HTTPS request
 */
function fetchUrl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const protocol = parsed.protocol === 'https:' ? https : http;

    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        ...options.headers,
      },
      timeout: options.timeout || 15000,
      rejectUnauthorized: false, // Allow self-signed certs
    };

    const req = protocol.request(reqOptions, (res) => {
      let data = '';

      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        fetchUrl(redirectUrl, options).then(resolve).catch(reject);
        return;
      }

      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
        });
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.end();
  });
}

const definitions = [
  {
    name: 'web_search',
    description: 'Search the web using DuckDuckGo. Returns search results with titles and snippets. Use run_type: "async" for parallel searches.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        results_count: {
          type: 'integer',
          description: 'Number of results to return (default: 5, max: 10)',
        },
        run_type: {
          type: 'string',
          enum: ['sync', 'async'],
          description: 'sync: wait for result (default). async: return task_id for parallel execution',
        },
      },
      required: ['query'],
    },
  },
];

/**
 * Core search execution (used by both sync and async modes)
 */
async function executeSearch(query, resultsCount) {
  // Use DuckDuckGo HTML search (no API key needed)
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const response = await fetchUrl(searchUrl);

  if (response.statusCode !== 200) {
    return { success: false, error: `Search returned status ${response.statusCode}` };
  }

  // Parse DuckDuckGo results
  const results = [];
  const resultRegex = /<a[^>]+class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  let match;
  while ((match = resultRegex.exec(response.data)) !== null && results.length < resultsCount) {
    const url = match[1];
    const title = htmlToText(match[2]);
    const snippet = htmlToText(match[3]);

    if (title && url) {
      results.push({ title, snippet, url });
    }
  }

  // Fallback: simpler regex for results
  if (results.length === 0) {
    const simpleRegex = /<a[^>]+class="result__a"[^>]*>([^<]+)<\/a>/gi;
    while ((match = simpleRegex.exec(response.data)) !== null && results.length < resultsCount) {
      results.push({ title: htmlToText(match[1]), snippet: '', url: '' });
    }
  }

  return {
    success: true,
    query,
    results,
    count: results.length,
  };
}

const handlers = {
  async web_search(input) {
    const query = (input.query || '').trim();
    const resultsCount = Math.min(input.results_count || 5, 10);
    const runType = input.run_type || 'sync';

    if (!query) {
      return { success: false, error: 'Query is required' };
    }

    // Async execution - return task_id immediately
    if (runType === 'async') {
      const { taskId } = startTask({
        name: `web_search: ${query.slice(0, 40)}${query.length > 40 ? '...' : ''}`,
        type: 'web',
        metadata: { query, resultsCount },
        executor: () => executeSearch(query, resultsCount)
      });

      return {
        success: true,
        async: true,
        task_id: taskId,
        message: `Search started asynchronously. Use await_tasks(["${taskId}"]) to get results.`
      };
    }

    // Sync execution
    try {
      return await executeSearch(query, resultsCount);
    } catch (error) {
      return { success: false, error: error.message, query };
    }
  },
};

module.exports = { definitions, handlers };
