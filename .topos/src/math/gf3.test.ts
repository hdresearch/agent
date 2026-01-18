import { test, expect, describe } from "bun:test";
import {
  type Trit,
  TritLabel,
  addGF3,
  negateGF3,
  sumGF3,
  isBalanced,
  balanceTriad,
  isQuadBalanced,
  createBalancedQuad,
  stringToTrit,
  findSkillsWithTrit,
  suggestBalancingSkills,
  analyzeQuad,
  tritToLabel,
  labelToTrit,
} from "./gf3";

describe("GF(3) Field Arithmetic", () => {
  describe("addGF3", () => {
    test("adds trits correctly", () => {
      expect(addGF3(1, 1)).toBe(-1); // 2 mod 3 = -1 in balanced ternary
      expect(addGF3(-1, 1)).toBe(0);
      expect(addGF3(0, -1)).toBe(-1);
      expect(addGF3(0, 0)).toBe(0);
      expect(addGF3(1, 0)).toBe(1);
    });

    test("is commutative", () => {
      expect(addGF3(1, -1)).toBe(addGF3(-1, 1));
      expect(addGF3(1, 0)).toBe(addGF3(0, 1));
    });
  });

  describe("negateGF3", () => {
    test("negates trits correctly", () => {
      expect(negateGF3(1)).toBe(-1);
      expect(negateGF3(-1)).toBe(1);
      expect(negateGF3(0)).toBe(0);
    });

    test("double negation is identity", () => {
      expect(negateGF3(negateGF3(1))).toBe(1);
      expect(negateGF3(negateGF3(-1))).toBe(-1);
      expect(negateGF3(negateGF3(0))).toBe(0);
    });
  });

  describe("sumGF3", () => {
    test("sums empty array to 0", () => {
      expect(sumGF3([])).toBe(0);
    });

    test("sums trits correctly", () => {
      expect(sumGF3([1, 1, 1])).toBe(0); // 3 ≡ 0 (mod 3)
      expect(sumGF3([1, -1, 0])).toBe(0);
      expect(sumGF3([1, 1, -1, -1])).toBe(0);
      expect(sumGF3([1, 1])).toBe(-1); // 2 ≡ -1
    });
  });

  describe("isBalanced", () => {
    test("detects balanced collections", () => {
      expect(isBalanced([1, -1, 0])).toBe(true);
      expect(isBalanced([1, 1, 1])).toBe(true); // 3 ≡ 0
      expect(isBalanced([1, 1, -1, -1])).toBe(true);
    });

    test("detects unbalanced collections", () => {
      expect(isBalanced([1, 1])).toBe(false); // 2 ≡ -1
      expect(isBalanced([1, 0])).toBe(false);
      expect(isBalanced([1])).toBe(false);
    });
  });
});

describe("Triad and Quad Operations", () => {
  describe("balanceTriad", () => {
    test("computes balancing trit correctly", () => {
      expect(balanceTriad([1, 1, 1])).toBe(0); // 3 ≡ 0, need 0 more
      expect(balanceTriad([1, 1, -1])).toBe(-1); // 1 + 1 - 1 = 1, need -1
      expect(balanceTriad([0, 0, 0])).toBe(0);
      expect(balanceTriad([1, 0, 0])).toBe(-1);
    });

    test("creates balanced quads", () => {
      const triad1: [Trit, Trit, Trit] = [1, 1, -1];
      const balancing1 = balanceTriad(triad1);
      expect(isBalanced([...triad1, balancing1])).toBe(true);

      const triad2: [Trit, Trit, Trit] = [1, 0, -1];
      const balancing2 = balanceTriad(triad2);
      expect(isBalanced([...triad2, balancing2])).toBe(true);
    });
  });

  describe("isQuadBalanced", () => {
    test("detects balanced quads", () => {
      expect(isQuadBalanced([1, 1, -1, -1])).toBe(true);
      expect(isQuadBalanced([1, 1, 1, 0])).toBe(true); // 3 + 0 = 3 ≡ 0
      expect(isQuadBalanced([0, 0, 0, 0])).toBe(true);
    });

    test("detects unbalanced quads", () => {
      expect(isQuadBalanced([1, 1, 1, 1])).toBe(false); // 4 ≡ 1
      expect(isQuadBalanced([1, 0, 0, 0])).toBe(false);
    });
  });

  describe("createBalancedQuad", () => {
    test("creates balanced quad with correct trit", () => {
      const quad = createBalancedQuad(
        ["skill-a", "skill-b", "skill-c"],
        [1, 1, -1]
      );
      
      expect(quad.balanced).toBe(true);
      expect(quad.requiredTrit).toBe(-1);
      expect(isBalanced(quad.trits)).toBe(true);
    });

    test("fourth skill is null (to be filled)", () => {
      const quad = createBalancedQuad(
        ["skill-a", "skill-b", "skill-c"],
        [1, 0, -1]
      );
      
      expect(quad.skills[3]).toBe(null);
    });
  });
});

describe("String Hashing", () => {
  describe("stringToTrit", () => {
    test("produces deterministic trits", () => {
      expect(stringToTrit("gay-mcp")).toBe(stringToTrit("gay-mcp"));
      expect(stringToTrit("acsets")).toBe(stringToTrit("acsets"));
    });

    test("produces valid trits", () => {
      const skills = ["gay-mcp", "acsets", "babashka", "algebraic-rewriting"];
      for (const skill of skills) {
        const trit = stringToTrit(skill);
        expect([-1, 0, 1]).toContain(trit);
      }
    });

    test("distributes across trit values", () => {
      const skills = Array.from({ length: 30 }, (_, i) => `skill-${i}`);
      const trits = skills.map(stringToTrit);
      
      const counts = {
        minus: trits.filter(t => t === -1).length,
        ergodic: trits.filter(t => t === 0).length,
        plus: trits.filter(t => t === 1).length,
      };
      
      // Should have some of each type (not perfect distribution expected)
      expect(counts.minus).toBeGreaterThan(0);
      expect(counts.ergodic).toBeGreaterThan(0);
      expect(counts.plus).toBeGreaterThan(0);
    });
  });

  describe("findSkillsWithTrit", () => {
    test("finds skills with target trit", () => {
      const skills = ["skill-a", "skill-b", "skill-c", "skill-d"];
      const results = findSkillsWithTrit(skills, 1, 10);
      
      for (const skill of results) {
        expect(stringToTrit(skill)).toBe(1);
      }
    });

    test("respects limit", () => {
      const skills = Array.from({ length: 100 }, (_, i) => `skill-${i}`);
      const results = findSkillsWithTrit(skills, 1, 5);
      
      expect(results.length).toBeLessThanOrEqual(5);
    });
  });
});

describe("Quad Analysis", () => {
  describe("analyzeQuad", () => {
    test("analyzes balanced quad", () => {
      const analysis = analyzeQuad([
        "skill-a",
        "skill-b",
        "skill-c",
        "skill-d",
      ]);
      
      expect(analysis.skills.length).toBe(4);
      expect(analysis.trits.length).toBe(4);
      expect([-1, 0, 1]).toContain(analysis.sum);
      expect(typeof analysis.balanced).toBe("boolean");
    });

    test("computes trit distribution", () => {
      const analysis = analyzeQuad([
        "skill-a",
        "skill-b",
        "skill-c",
        "skill-d",
      ]);
      
      const total =
        analysis.tritDistribution.minus +
        analysis.tritDistribution.ergodic +
        analysis.tritDistribution.plus;
      
      expect(total).toBe(4);
    });

    test("detects unbalanced quad", () => {
      // Create a quad we know is unbalanced
      const skills: [string, string, string, string] = ["a", "a", "a", "a"];
      const analysis = analyzeQuad(skills);
      
      // If all hash to same trit, quad is unbalanced unless trit is 0
      if (analysis.trits[0] !== 0) {
        expect(analysis.balanced).toBe(false);
      }
    });
  });

  describe("suggestBalancingSkills", () => {
    test("suggests skills that balance triad", () => {
      const skillPool = Array.from({ length: 100 }, (_, i) => `skill-${i}`);
      const suggestions = suggestBalancingSkills(
        ["skill-a", "skill-b", "skill-c"],
        skillPool,
        5
      );
      
      expect(suggestions.length).toBeLessThanOrEqual(5);
      
      for (const suggestion of suggestions) {
        expect(suggestion.resultingQuad.balanced).toBe(true);
        expect(isBalanced(suggestion.resultingQuad.trits)).toBe(true);
      }
    });

    test("suggested quads include original triad", () => {
      const triad: [string, string, string] = ["skill-a", "skill-b", "skill-c"];
      const skillPool = Array.from({ length: 50 }, (_, i) => `skill-${i}`);
      const suggestions = suggestBalancingSkills(triad, skillPool, 3);
      
      for (const suggestion of suggestions) {
        expect(suggestion.resultingQuad.skills.slice(0, 3)).toEqual(triad);
      }
    });
  });
});

describe("Label Conversion", () => {
  describe("tritToLabel", () => {
    test("converts trits to labels", () => {
      expect(tritToLabel(-1)).toBe("MINUS");
      expect(tritToLabel(0)).toBe("ERGODIC");
      expect(tritToLabel(1)).toBe("PLUS");
    });
  });

  describe("labelToTrit", () => {
    test("converts labels to trits", () => {
      expect(labelToTrit("MINUS")).toBe(-1);
      expect(labelToTrit("ERGODIC")).toBe(0);
      expect(labelToTrit("PLUS")).toBe(1);
    });
  });

  test("round-trip conversion", () => {
    expect(labelToTrit(tritToLabel(-1))).toBe(-1);
    expect(labelToTrit(tritToLabel(0))).toBe(0);
    expect(labelToTrit(tritToLabel(1))).toBe(1);

    expect(tritToLabel(labelToTrit("MINUS"))).toBe("MINUS");
    expect(tritToLabel(labelToTrit("ERGODIC"))).toBe("ERGODIC");
    expect(tritToLabel(labelToTrit("PLUS"))).toBe("PLUS");
  });
});

describe("TritLabel Constants", () => {
  test("constants have correct values", () => {
    expect(TritLabel.MINUS).toBe(-1);
    expect(TritLabel.ERGODIC).toBe(0);
    expect(TritLabel.PLUS).toBe(1);
  });
});

describe("Integration: Real-world Scenarios", () => {
  test("balancing a skill triad for agent coordination", () => {
    // Scenario: We have 3 skills and need to find a 4th
    const triad: [string, string, string] = [
      "gay-mcp",
      "acsets",
      "babashka",
    ];
    
    const trits = triad.map(stringToTrit) as [Trit, Trit, Trit];
    const requiredTrit = balanceTriad(trits);
    
    // Find skills from a pool that have the required trit
    const skillPool = [
      "algebraic-rewriting",
      "geometric-algebra",
      "topos-theory",
      "category-theory",
    ];
    
    const candidates = findSkillsWithTrit(skillPool, requiredTrit, 1);
    
    if (candidates.length > 0) {
      const quad = [...triad, candidates[0]] as [string, string, string, string];
      const analysis = analyzeQuad(quad);
      expect(analysis.balanced).toBe(true);
    }
  });

  test("analyzing existing quad for validation", () => {
    // Scenario: Validate that an existing quad is balanced
    const quad: [string, string, string, string] = [
      "gay-mcp",
      "acsets",
      "babashka",
      "algebraic-rewriting",
    ];
    
    const analysis = analyzeQuad(quad);
    
    expect(analysis.skills).toEqual(quad);
    expect(analysis.trits.length).toBe(4);
    expect(typeof analysis.balanced).toBe("boolean");
    
    if (analysis.balanced) {
      expect(sumGF3(analysis.trits)).toBe(0);
    }
  });

  test("triadic decomposition: MINUS/ERGODIC/PLUS pattern", () => {
    // Scenario: Verify a common pattern of one of each type
    const quad: [Trit, Trit, Trit, Trit] = [-1, 0, 1, 0];
    
    expect(isBalanced(quad)).toBe(true);
    
    const distribution = {
      minus: quad.filter(t => t === -1).length,
      ergodic: quad.filter(t => t === 0).length,
      plus: quad.filter(t => t === 1).length,
    };
    
    expect(distribution.minus).toBe(1);
    expect(distribution.ergodic).toBe(2);
    expect(distribution.plus).toBe(1);
  });
});
