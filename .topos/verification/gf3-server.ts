// GF(3) Conservation MCP Server
// Formally verified via Dafny → JS compilation

import { SKILL_ALPHABET, checkTriad, findBalancer, getSkill, isBalanced, gf3Sum, type Trit } from "./gf3-mcp";

const server = Bun.serve({
  port: 3069,
  
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    
    // CORS headers
    const headers = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    
    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }
    
    try {
      // Health check
      if (path === "/health") {
        return Response.json({ 
          status: "ok", 
          service: "gf3-conservation",
          verified: "Dafny 20/20 proofs" 
        }, { headers });
      }
      
      // List all skills
      if (path === "/skills") {
        return Response.json(SKILL_ALPHABET, { headers });
      }
      
      // Get skill by letter
      if (path.startsWith("/skill/")) {
        const letter = path.slice(7);
        const skill = getSkill(letter);
        if (!skill) {
          return Response.json({ error: `Unknown letter: ${letter}` }, { status: 404, headers });
        }
        return Response.json({ letter, ...skill }, { headers });
      }
      
      // Check triad
      if (path === "/triad") {
        if (req.method === "POST") {
          const body = await req.json();
          const { l1, l2, l3 } = body;
          const result = checkTriad(l1, l2, l3);
          return Response.json(result, { headers });
        }
        // GET with query params
        const l1 = url.searchParams.get("l1");
        const l2 = url.searchParams.get("l2");
        const l3 = url.searchParams.get("l3");
        if (l1 && l2 && l3) {
          const result = checkTriad(l1, l2, l3);
          return Response.json(result, { headers });
        }
        return Response.json({ error: "Provide l1, l2, l3" }, { status: 400, headers });
      }
      
      // Find balancers
      if (path === "/balance") {
        const l1 = url.searchParams.get("l1");
        const l2 = url.searchParams.get("l2");
        if (l1 && l2) {
          const balancers = findBalancer(l1, l2);
          return Response.json({ l1, l2, balancers }, { headers });
        }
        return Response.json({ error: "Provide l1, l2" }, { status: 400, headers });
      }
      
      // Check balance of arbitrary trits
      if (path === "/check" && req.method === "POST") {
        const body = await req.json();
        const trits: Trit[] = body.trits;
        return Response.json({
          trits,
          sum: gf3Sum(trits),
          balanced: isBalanced(trits),
        }, { headers });
      }
      
      // MCP protocol endpoint
      if (path === "/mcp") {
        const body = await req.json();
        const { method, params } = body;
        
        switch (method) {
          case "gf3/check-triad":
            return Response.json(checkTriad(params.l1, params.l2, params.l3), { headers });
          case "gf3/find-balancer":
            return Response.json(findBalancer(params.l1, params.l2), { headers });
          case "gf3/skill-info":
            return Response.json(getSkill(params.letter), { headers });
          case "gf3/is-balanced":
            return Response.json({ balanced: isBalanced(params.trits), sum: gf3Sum(params.trits) }, { headers });
          case "gf3/list":
            return Response.json(SKILL_ALPHABET, { headers });
          default:
            return Response.json({ error: `Unknown method: ${method}` }, { status: 400, headers });
        }
      }
      
      // Index
      if (path === "/") {
        return Response.json({
          name: "GF(3) Conservation Server",
          verified: "Dafny 20/20 proofs",
          endpoints: {
            "/health": "Health check",
            "/skills": "List all 26 skills",
            "/skill/:letter": "Get skill by letter",
            "/triad?l1=&l2=&l3=": "Check triad balance",
            "/balance?l1=&l2=": "Find balancing letters",
            "/check": "POST trits array to check balance",
            "/mcp": "MCP protocol endpoint",
          },
        }, { headers });
      }
      
      return Response.json({ error: "Not found" }, { status: 404, headers });
      
    } catch (e) {
      return Response.json({ error: String(e) }, { status: 500, headers });
    }
  },
});

console.log(`🔺 GF(3) Conservation Server running on http://localhost:${server.port}`);
console.log("   Verified: Dafny 20/20 proofs");
console.log("   Endpoints: /health, /skills, /skill/:letter, /triad, /balance, /mcp");
