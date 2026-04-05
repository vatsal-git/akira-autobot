/**
 * Web Tools
 * web_search, fetch_webpage
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

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
 * Extract title from HTML
 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? match[1].trim() : '';
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
    description: 'Search the web using DuckDuckGo. Returns search results with titles and snippets.',
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
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_webpage',
    description: 'Fetch and extract content from a webpage URL. Returns title and text content.',
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL of the webpage to fetch',
        },
        extract_main_content: {
          type: 'boolean',
          description: 'Extract just text content (true) or return full HTML (false). Default: true',
        },
        max_length: {
          type: 'integer',
          description: 'Maximum content length to return (default: 50000)',
        },
      },
      required: ['url'],
    },
  },
];

const handlers = {
  async web_search(input) {
    const query = (input.query || '').trim();
    const resultsCount = Math.min(input.results_count || 5, 10);

    if (!query) {
      return { success: false, error: 'Query is required' };
    }

    try {
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
    } catch (error) {
      return { success: false, error: error.message, query };
    }
  },

  async fetch_webpage(input) {
    const url = (input.url || '').trim();
    const extractContent = input.extract_main_content !== false;
    const maxLength = input.max_length || 50000;

    if (!url) {
      return { success: false, error: 'URL is required' };
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return { success: false, error: 'Invalid URL format' };
    }

    try {
      const response = await fetchUrl(url, { timeout: 15000 });

      if (response.statusCode !== 200) {
        return { success: false, error: `HTTP status ${response.statusCode}`, url };
      }

      const html = response.data;
      const title = extractTitle(html);

      let content;
      if (extractContent) {
        content = htmlToText(html);
        if (content.length > maxLength) {
          content = content.substring(0, maxLength) + '\n\n[Content truncated...]';
        }
      } else {
        content = html.substring(0, maxLength);
      }

      return {
        success: true,
        title,
        content,
        url,
        content_type: response.headers['content-type'] || '',
      };
    } catch (error) {
      return { success: false, error: error.message, url };
    }
  },
};

module.exports = { definitions, handlers };
