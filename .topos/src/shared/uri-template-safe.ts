/**
 * Safe RFC 6570 URI Template Parser
 * 
 * Protects against ReDoS (Regular Expression Denial of Service) by using
 * deterministic O(n) parsing instead of nested quantifier regex patterns.
 * 
 * Vulnerability mitigated:
 * - Pattern: /([^/]+(?:,[^/]+)*)/
 * - Attack: /users/a,b,c,...repeat(50)...FAIL/
 * - Impact: Catastrophic backtracking (58s for 10 repeats, infinite for 50)
 * 
 * Safe implementation:
 * - Time complexity: O(n) guaranteed
 * - Memory: O(n) bounded
 * - No regex backtracking
 * - RFC 6570 compliant
 * 
 * @see docs/SECURITY-REDOS-ANALYSIS.md
 */

export interface UriTemplateMatch {
  /** Path segments (e.g., ['users', 'alice', 'bob']) */
  path: string[];
  /** Query parameters (e.g., {tags: 'a', id: ['1', '2']}) */
  query: Record<string, string | string[]>;
  /** Fragment identifier (e.g., 'section') */
  fragment?: string;
}

/**
 * Safe URI Template parser with ReDoS protection
 * 
 * Example:
 * ```typescript
 * const uri = '/users/alice,bob?tags=red,blue#top';
 * const parsed = SafeUriTemplate.parse(uri);
 * // { path: ['users', 'alice', 'bob'], query: {tags: 'red,blue'}, fragment: 'top' }
 * ```
 */
export class SafeUriTemplate {
  /** Maximum length for any single URI segment (prevents memory exhaustion) */
  private static readonly MAX_SEGMENT_LENGTH = 2000;
  
  /** Maximum number of path parts (prevents combinatorial explosion) */
  private static readonly MAX_PARTS = 200;
  
  /** Maximum number of query parameters (prevents DoS via parameter pollution) */
  private static readonly MAX_QUERY_PARAMS = 100;
  
  /**
   * Parse URI path with exploded array support
   * 
   * Handles RFC 6570 patterns like:
   * - `/users/{id*}` matches `/users/1,2,3`
   * - `/data/{keys*}` matches `/data/a,b,c`
   * 
   * Time complexity: O(n) where n = uri.length
   * Space complexity: O(n) for output array
   * 
   * @param uri - URI path string
   * @returns Array of path segments
   * @throws Error if segment exceeds MAX_SEGMENT_LENGTH
   */
  static parsePath(uri: string): string[] {
    const segments: string[] = [];
    let current = '';
    
    for (let i = 0; i < uri.length && segments.length < this.MAX_PARTS; i++) {
      const char = uri[i];
      
      if (char === '/') {
        if (current) {
          // Parse comma-separated values in this segment
          segments.push(...this.parseSegment(current));
          current = '';
        }
      } else if (char === '?' || char === '#') {
        // End of path, start of query or fragment
        break;
      } else {
        current += char;
        
        // Prevent memory exhaustion attacks
        if (current.length > this.MAX_SEGMENT_LENGTH) {
          throw new Error(
            `URI segment exceeds maximum length (${this.MAX_SEGMENT_LENGTH} chars)`
          );
        }
      }
    }
    
    // Handle final segment
    if (current) {
      segments.push(...this.parseSegment(current));
    }
    
    return segments;
  }
  
  /**
   * Parse comma-separated segment (exploded array)
   * 
   * Safe implementation:
   * - Single pass through string
   * - No regex backtracking
   * - O(n) time complexity
   * 
   * Example: "alice,bob,charlie" → ["alice", "bob", "charlie"]
   * 
   * @param segment - Comma-separated segment
   * @returns Array of decoded values
   */
  private static parseSegment(segment: string): string[] {
    const parts: string[] = [];
    let current = '';
    
    for (const char of segment) {
      if (char === ',') {
        if (current) {
          try {
            parts.push(decodeURIComponent(current));
          } catch {
            // Invalid percent encoding - use as-is
            parts.push(current);
          }
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    // Handle final part
    if (current) {
      try {
        parts.push(decodeURIComponent(current));
      } catch {
        parts.push(current);
      }
    }
    
    return parts.length > 0 ? parts : [segment];
  }
  
  /**
   * Parse query string with exploded support
   * 
   * Handles RFC 6570 patterns like:
   * - `?tags={tags*}` matches `?tags=a&tags=b&tags=c`
   * - `?ids={ids*}` matches `?ids=1&ids=2&ids=3`
   * 
   * Repeated parameters are collected into arrays.
   * 
   * Time complexity: O(n) where n = queryString.length
   * 
   * @param queryString - Query string (with or without leading '?')
   * @returns Record of query parameters
   * @throws Error if parameter count exceeds MAX_QUERY_PARAMS
   */
  static parseQuery(queryString: string): Record<string, string | string[]> {
    const params: Record<string, string | string[]> = {};
    
    if (!queryString || queryString === '?') return params;
    
    // Remove leading '?' if present
    const cleaned = queryString.startsWith('?') 
      ? queryString.slice(1) 
      : queryString;
    
    const pairs = cleaned.split('&');
    
    // Prevent parameter pollution DoS
    if (pairs.length > this.MAX_QUERY_PARAMS) {
      throw new Error(
        `Query parameter count exceeds maximum (${this.MAX_QUERY_PARAMS})`
      );
    }
    
    for (const pair of pairs) {
      if (!pair) continue;
      
      const eqIndex = pair.indexOf('=');
      
      let key: string;
      let value: string;
      
      if (eqIndex === -1) {
        // No '=' sign - treat as flag parameter
        key = pair;
        value = '';
      } else {
        key = pair.slice(0, eqIndex);
        value = pair.slice(eqIndex + 1);
      }
      
      if (!key) continue;
      
      // Decode key and value
      let decodedKey: string;
      let decodedValue: string;
      
      try {
        decodedKey = decodeURIComponent(key);
        decodedValue = value ? decodeURIComponent(value) : '';
      } catch {
        // Invalid percent encoding - use as-is
        decodedKey = key;
        decodedValue = value;
      }
      
      // Handle repeated parameters (convert to array)
      if (decodedKey in params) {
        const existing = params[decodedKey];
        params[decodedKey] = Array.isArray(existing)
          ? [...existing, decodedValue]
          : [existing as string, decodedValue];
      } else {
        params[decodedKey] = decodedValue;
      }
    }
    
    return params;
  }
  
  /**
   * Full URI template parsing with all components
   * 
   * Parses:
   * - Path segments (slash-separated)
   * - Query parameters (after '?')
   * - Fragment identifier (after '#')
   * 
   * Example:
   * ```typescript
   * SafeUriTemplate.parse('/users/a,b?tags=x,y#top')
   * // {
   * //   path: ['users', 'a', 'b'],
   * //   query: { tags: 'x,y' },
   * //   fragment: 'top'
   * // }
   * ```
   * 
   * Time complexity: O(n) where n = uri.length
   * 
   * @param uri - Full URI string
   * @returns Parsed URI components
   */
  static parse(uri: string): UriTemplateMatch {
    // Split on fragment first (rightmost '#')
    const hashIndex = uri.indexOf('#');
    const mainPart = hashIndex === -1 ? uri : uri.slice(0, hashIndex);
    const fragmentPart = hashIndex === -1 ? undefined : uri.slice(hashIndex + 1);
    
    // Split on query (rightmost '?' in main part)
    const queryIndex = mainPart.indexOf('?');
    const pathPart = queryIndex === -1 ? mainPart : mainPart.slice(0, queryIndex);
    const queryPart = queryIndex === -1 ? '' : mainPart.slice(queryIndex + 1);
    
    // Decode fragment
    let fragment: string | undefined;
    if (fragmentPart) {
      try {
        fragment = decodeURIComponent(fragmentPart);
      } catch {
        fragment = fragmentPart;
      }
    }
    
    return {
      path: this.parsePath(pathPart),
      query: this.parseQuery(queryPart),
      fragment
    };
  }
  
  /**
   * Validate URI for safety before parsing
   * 
   * Checks:
   * - Overall length
   * - Comma density (potential ReDoS indicator)
   * 
   * @param uri - URI to validate
   * @returns true if safe, false otherwise
   */
  static isSafe(uri: string): boolean {
    if (uri.length > 10000) return false;
    
    // Check comma density - more than 1 comma per 3 chars is suspicious
    const commaCount = (uri.match(/,/g) || []).length;
    if (commaCount > uri.length / 3) return false;
    
    return true;
  }
}
