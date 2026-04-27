/**
 * Response Cache System
 * Caches responses for queries that don't require realtime tool use
 */

const Store = require('electron-store');

// Persistent cache store
const cacheStore = new Store({
  name: 'akira-response-cache',
  defaults: {
    entries: [] // Array of { key, normalizedQuery, response, timestamp, hitCount }
  }
});

// Patterns that indicate a cacheable query (greetings, simple questions)
const CACHEABLE_PATTERNS = [
  // Greetings
  /^(hi|hello|hey|howdy|hola|greetings|good\s*(morning|afternoon|evening|night))[\s!.?]*$/i,
  /^(what'?s?\s*up|sup|yo)[\s!.?]*$/i,

  // Identity questions
  /^(who|what)\s+(are|r)\s+(you|u)[\s!.?]*$/i,
  /^(what'?s?\s*your\s*name)[\s!.?]*$/i,
  /^(can\s+you\s+)?introduce\s+yourself[\s!.?]*$/i,

  // Capability questions
  /^what\s+can\s+you\s+do[\s!.?]*$/i,
  /^(how\s+can\s+you\s+)?help\s*me[\s!.?]*$/i,

  // Simple thanks/bye
  /^(thanks?|thank\s*you|thx|ty)[\s!.?]*$/i,
  /^(bye|goodbye|see\s*ya|later|cya)[\s!.?]*$/i,

  // Simple affirmations
  /^(ok|okay|sure|yes|no|yep|nope|got\s*it|understood)[\s!.?]*$/i
];

// Patterns that indicate NON-cacheable queries (need tools/realtime data)
const NON_CACHEABLE_PATTERNS = [
  // File operations
  /\b(file|folder|directory|read|write|create|delete|open|save|list)\b/i,

  // System operations
  /\b(run|execute|command|terminal|shell|script|install)\b/i,

  // Web operations
  /\b(search|google|browse|website|url|http|fetch|download)\b/i,

  // Desktop automation
  /\b(click|mouse|keyboard|type|screenshot|screen|window|app)\b/i,

  // Time-sensitive
  /\b(now|today|current|latest|recent|weather|news|time|date)\b/i,

  // Memory operations
  /\b(remember|recall|forget|memory|stored)\b/i,

  // Specific paths or commands
  /[A-Z]:\\|\/home\/|~\/|\.(exe|bat|sh|py|js|txt|md)/i
];

/**
 * Normalize a query for cache key matching
 * @param {string} query - Raw user query
 * @returns {string} Normalized query
 */
function normalizeQuery(query) {
  return query
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ');   // Normalize whitespace
}

/**
 * Calculate similarity between two strings (0-1)
 * Uses a combination of Levenshtein distance and word overlap
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {number} Similarity score (0-1)
 */
function calculateSimilarity(a, b) {
  const normA = normalizeQuery(a);
  const normB = normalizeQuery(b);

  // Exact match
  if (normA === normB) return 1.0;

  // Word overlap score
  const wordsA = new Set(normA.split(' ').filter(w => w.length > 0));
  const wordsB = new Set(normB.split(' ').filter(w => w.length > 0));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccardSimilarity = intersection / union;

  // Levenshtein distance (normalized)
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(normA, normB);
  const levenshteinSimilarity = 1 - (distance / maxLen);

  // Combined score (weighted average)
  return (jaccardSimilarity * 0.6) + (levenshteinSimilarity * 0.4);
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if a query is cacheable based on patterns
 * @param {string} query - User query
 * @returns {boolean} True if definitely cacheable
 */
function isCacheablePattern(query) {
  const normalized = normalizeQuery(query);

  // Check non-cacheable patterns first
  for (const pattern of NON_CACHEABLE_PATTERNS) {
    if (pattern.test(query)) {
      return false;
    }
  }

  // Check cacheable patterns
  for (const pattern of CACHEABLE_PATTERNS) {
    if (pattern.test(query) || pattern.test(normalized)) {
      return true;
    }
  }

  return false;
}

/**
 * Get cached response for a query
 * @param {string} query - User query
 * @returns {Object|null} Cached entry or null
 */
function getCachedResponse(query) {
  const entries = cacheStore.get('entries', []);
  const normalized = normalizeQuery(query);

  // Find best matching entry
  let bestMatch = null;
  let bestScore = 0;
  const SIMILARITY_THRESHOLD = 0.85;

  for (const entry of entries) {
    const similarity = calculateSimilarity(normalized, entry.normalizedQuery);

    if (similarity > bestScore && similarity >= SIMILARITY_THRESHOLD) {
      bestScore = similarity;
      bestMatch = entry;
    }
  }

  if (bestMatch) {
    // Update hit count
    bestMatch.hitCount = (bestMatch.hitCount || 0) + 1;
    bestMatch.lastHit = Date.now();
    cacheStore.set('entries', entries);

    console.log(`[cache] Hit for "${query}" (similarity: ${bestScore.toFixed(2)}, hits: ${bestMatch.hitCount})`);
    return bestMatch;
  }

  return null;
}

/**
 * Store a response in cache
 * @param {string} query - Original query
 * @param {string} response - Response to cache
 */
function cacheResponse(query, response) {
  const entries = cacheStore.get('entries', []);
  const normalized = normalizeQuery(query);

  // Check if similar entry already exists
  const existingIndex = entries.findIndex(e =>
    calculateSimilarity(normalized, e.normalizedQuery) >= 0.95
  );

  const entry = {
    key: normalized,
    normalizedQuery: normalized,
    originalQuery: query,
    response,
    timestamp: Date.now(),
    hitCount: 0
  };

  if (existingIndex >= 0) {
    // Update existing entry
    entries[existingIndex] = entry;
  } else {
    // Add new entry (limit to 500 entries)
    entries.unshift(entry);
    if (entries.length > 500) {
      // Remove least used entries
      entries.sort((a, b) => (b.hitCount || 0) - (a.hitCount || 0));
      entries.splice(500);
    }
  }

  cacheStore.set('entries', entries);
  console.log(`[cache] Stored response for "${query}"`);
}

/**
 * Check if query should attempt cache lookup
 * @param {string} query - User query
 * @returns {boolean}
 */
function shouldCheckCache(query) {
  // Quick pattern check first
  if (isCacheablePattern(query)) {
    return true;
  }

  // Short queries (< 50 chars) without obvious tool indicators might be cacheable
  if (query.length < 50) {
    for (const pattern of NON_CACHEABLE_PATTERNS) {
      if (pattern.test(query)) {
        return false;
      }
    }
    // Check if we have a cached response for similar query
    return getCachedResponse(query) !== null;
  }

  return false;
}

/**
 * Clear all cached responses
 */
function clearCache() {
  cacheStore.set('entries', []);
  console.log('[cache] Cache cleared');
}

/**
 * Get cache statistics
 */
function getCacheStats() {
  const entries = cacheStore.get('entries', []);
  const totalHits = entries.reduce((sum, e) => sum + (e.hitCount || 0), 0);

  return {
    entryCount: entries.length,
    totalHits,
    oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.timestamp)) : null,
    newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.timestamp)) : null
  };
}

/**
 * Remove a specific entry from cache
 * @param {string} query - Query to remove
 */
function removeCacheEntry(query) {
  const entries = cacheStore.get('entries', []);
  const normalized = normalizeQuery(query);

  const filtered = entries.filter(e =>
    calculateSimilarity(normalized, e.normalizedQuery) < 0.95
  );

  cacheStore.set('entries', filtered);
}

module.exports = {
  normalizeQuery,
  calculateSimilarity,
  isCacheablePattern,
  getCachedResponse,
  cacheResponse,
  shouldCheckCache,
  clearCache,
  getCacheStats,
  removeCacheEntry
};
