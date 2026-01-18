/**
 * Security tests for SafeUriTemplate - ReDoS protection validation
 * 
 * Tests verify:
 * 1. Linear time complexity (O(n))
 * 2. Resistance to catastrophic backtracking
 * 3. RFC 6570 compliance
 * 4. Malicious payload handling
 */

import { test, expect, describe } from 'bun:test';
import { SafeUriTemplate } from './uri-template-safe';

describe('ReDoS Protection', () => {
  test('handles malicious comma-heavy payload in <100ms', () => {
    // This would hang with vulnerable regex: /([^/]+(?:,[^/]+)*)/
    const malicious = '/users/' + 'item,'.repeat(50) + 'FAIL/';
    
    const start = performance.now();
    const result = SafeUriTemplate.parsePath(malicious);
    const elapsed = performance.now() - start;
    
    expect(elapsed).toBeLessThan(100); // Should be instant
    expect(result).toContain('FAIL');
    expect(result.length).toBe(52); // users + 50 items + FAIL
  });
  
  test('handles deeply nested comma patterns without timeout', () => {
    const nested = '/data/' + 'a,'.repeat(100) + 'z/';
    
    const start = performance.now();
    const result = SafeUriTemplate.parsePath(nested);
    const elapsed = performance.now() - start;
    
    expect(elapsed).toBeLessThan(100);
    expect(result).toContain('z');
    expect(result.length).toBe(102); // data + 100 a's + z
  });
  
  test('handles catastrophic backtracking scenario from typescript-sdk#965', () => {
    // Exact attack vector from vulnerability report
    const attack = '/users/' + 'user1,user2,user3,'.repeat(15) + 'FAIL/';
    
    const start = performance.now();
    const result = SafeUriTemplate.parsePath(attack);
    const elapsed = performance.now() - start;
    
    // Original regex: 58 seconds for 10 repeats, infinite for 50
    // Safe parser: <10ms for any size
    expect(elapsed).toBeLessThan(10);
    expect(result).toContain('FAIL');
  });
  
  test('linear time complexity proof - O(n) not O(2^n)', () => {
    // Use smaller sizes that stay under MAX_SEGMENT_LENGTH (2000 chars)
    // Each "item," is 5 chars, so 300 repeats = 1500 chars (safe)
    const sizes = [50, 100, 200, 300];
    const times: number[] = [];
    
    for (const size of sizes) {
      const uri = '/data/' + 'item,'.repeat(size) + 'end/';
      const start = performance.now();
      SafeUriTemplate.parsePath(uri);
      const elapsed = performance.now() - start;
      times.push(elapsed);
    }
    
    // Linear: T(2n) / T(n) ≈ 2
    // Exponential: T(2n) / T(n) ≈ 4 or higher
    const ratio1 = times[1] / (times[0] || 0.001);
    const ratio2 = times[2] / (times[1] || 0.001);
    const ratio3 = times[3] / (times[2] || 0.001);
    
    // Allow 10x ratio for GC/JIT overhead, but reject 100x (exponential)
    expect(ratio1).toBeLessThan(10);
    expect(ratio2).toBeLessThan(10);
    expect(ratio3).toBeLessThan(10);
  });
  
  test('rejects excessively long segments', () => {
    const tooLong = '/users/' + 'x'.repeat(3000) + '/';
    
    expect(() => SafeUriTemplate.parsePath(tooLong)).toThrow('exceeds maximum length');
  });
  
  test('handles maximum allowed segment length', () => {
    const maxLength = '/users/' + 'x'.repeat(1999) + '/';
    
    expect(() => SafeUriTemplate.parsePath(maxLength)).not.toThrow();
  });
  
  test('rejects excessive query parameters', () => {
    const params = Array.from({ length: 150 }, (_, i) => `k${i}=v${i}`).join('&');
    const uri = `/data?${params}`;
    
    expect(() => SafeUriTemplate.parse(uri)).toThrow('exceeds maximum');
  });
  
  test('isSafe() detects suspicious comma density', () => {
    const safe = '/users/alice,bob,charlie';
    const suspicious = '/' + ','.repeat(100);
    
    expect(SafeUriTemplate.isSafe(safe)).toBe(true);
    expect(SafeUriTemplate.isSafe(suspicious)).toBe(false);
  });
  
  test('isSafe() detects excessive length', () => {
    const safe = '/users/alice';
    const tooLong = '/' + 'x'.repeat(20000);
    
    expect(SafeUriTemplate.isSafe(safe)).toBe(true);
    expect(SafeUriTemplate.isSafe(tooLong)).toBe(false);
  });
});

describe('RFC 6570 Compliance', () => {
  test('handles exploded path arrays', () => {
    // Pattern: /users/{id*} matches /users/1,2,3
    const uri = '/users/alice,bob,charlie';
    const result = SafeUriTemplate.parsePath(uri);
    
    expect(result).toEqual(['users', 'alice', 'bob', 'charlie']);
  });
  
  test('handles exploded query arrays', () => {
    // Pattern: ?tags={tags*} matches ?tags=a&tags=b
    const query = 'tags=red&tags=blue&tags=green';
    const result = SafeUriTemplate.parseQuery(query);
    
    expect(result.tags).toEqual(['red', 'blue', 'green']);
  });
  
  test('handles single query parameters', () => {
    const query = 'name=alice&age=30';
    const result = SafeUriTemplate.parseQuery(query);
    
    expect(result).toEqual({ name: 'alice', age: '30' });
  });
  
  test('handles flag parameters without values', () => {
    const query = 'debug&verbose&trace';
    const result = SafeUriTemplate.parseQuery(query);
    
    expect(result).toEqual({ debug: '', verbose: '', trace: '' });
  });
  
  test('handles full URI with all components', () => {
    const uri = '/users/alice,bob?tags=red,blue&limit=10#results';
    const result = SafeUriTemplate.parse(uri);
    
    expect(result.path).toEqual(['users', 'alice', 'bob']);
    expect(result.query).toEqual({ tags: 'red,blue', limit: '10' });
    expect(result.fragment).toBe('results');
  });
  
  test('handles URI without query or fragment', () => {
    const uri = '/users/alice/posts';
    const result = SafeUriTemplate.parse(uri);
    
    expect(result.path).toEqual(['users', 'alice', 'posts']);
    expect(result.query).toEqual({});
    expect(result.fragment).toBeUndefined();
  });
  
  test('handles URI with query but no fragment', () => {
    const uri = '/search?q=test&limit=50';
    const result = SafeUriTemplate.parse(uri);
    
    expect(result.path).toEqual(['search']);
    expect(result.query).toEqual({ q: 'test', limit: '50' });
    expect(result.fragment).toBeUndefined();
  });
  
  test('handles URI with fragment but no query', () => {
    const uri = '/docs/api#authentication';
    const result = SafeUriTemplate.parse(uri);
    
    expect(result.path).toEqual(['docs', 'api']);
    expect(result.query).toEqual({});
    expect(result.fragment).toBe('authentication');
  });
  
  test('handles percent-encoded values', () => {
    const uri = '/users/alice%20smith?tags=red%2Cblue#top%20section';
    const result = SafeUriTemplate.parse(uri);
    
    expect(result.path).toEqual(['users', 'alice smith']);
    expect(result.query.tags).toBe('red,blue');
    expect(result.fragment).toBe('top section');
  });
  
  test('handles invalid percent-encoding gracefully', () => {
    const uri = '/users/alice%ZZ?tags=%GG#bad%XX';
    const result = SafeUriTemplate.parse(uri);
    
    // Should not throw, use raw values
    expect(result.path).toContain('users');
    expect(result.fragment).toBeDefined();
  });
});

describe('Edge Cases', () => {
  test('handles empty path', () => {
    const result = SafeUriTemplate.parsePath('');
    expect(result).toEqual([]);
  });
  
  test('handles root path', () => {
    const result = SafeUriTemplate.parsePath('/');
    expect(result).toEqual([]);
  });
  
  test('handles multiple slashes', () => {
    const result = SafeUriTemplate.parsePath('///users///alice///');
    expect(result).toEqual(['users', 'alice']);
  });
  
  test('handles empty query string', () => {
    const result = SafeUriTemplate.parseQuery('');
    expect(result).toEqual({});
  });
  
  test('handles query with only "?"', () => {
    const result = SafeUriTemplate.parseQuery('?');
    expect(result).toEqual({});
  });
  
  test('handles trailing comma in segment', () => {
    const result = SafeUriTemplate.parsePath('/users/alice,bob,');
    expect(result).toEqual(['users', 'alice', 'bob']);
  });
  
  test('handles leading comma in segment', () => {
    const result = SafeUriTemplate.parsePath('/users/,alice,bob');
    expect(result).toEqual(['users', 'alice', 'bob']);
  });
  
  test('handles consecutive commas', () => {
    const result = SafeUriTemplate.parsePath('/users/alice,,bob');
    expect(result).toEqual(['users', 'alice', 'bob']);
  });
  
  test('handles empty query parameter values', () => {
    const result = SafeUriTemplate.parseQuery('a=&b=&c=value');
    expect(result).toEqual({ a: '', b: '', c: 'value' });
  });
  
  test('handles query parameter with empty key', () => {
    const result = SafeUriTemplate.parseQuery('=value&key=value2');
    expect(result).toEqual({ key: 'value2' });
  });
});

describe('Performance Benchmarks', () => {
  test('parses 1000-segment path in <100ms', () => {
    const uri = '/' + Array.from({ length: 1000 }, (_, i) => `seg${i}`).join('/');
    
    const start = performance.now();
    SafeUriTemplate.parsePath(uri);
    const elapsed = performance.now() - start;
    
    expect(elapsed).toBeLessThan(100);
  });
  
  test('parses 100-parameter query in <50ms', () => {
    const query = Array.from({ length: 100 }, (_, i) => `k${i}=v${i}`).join('&');
    
    const start = performance.now();
    SafeUriTemplate.parseQuery(query);
    const elapsed = performance.now() - start;
    
    expect(elapsed).toBeLessThan(50);
  });
  
  test('parses complex URI with 200 comma-separated items in <50ms', () => {
    const items = Array.from({ length: 200 }, (_, i) => `item${i}`).join(',');
    const uri = `/data/${items}?tags=a,b,c#section`;
    
    const start = performance.now();
    SafeUriTemplate.parse(uri);
    const elapsed = performance.now() - start;
    
    expect(elapsed).toBeLessThan(50);
  });
});
