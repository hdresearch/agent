/**
 * Clone repo, branch VM 5 times, and search for typos in parallel
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

import { execute, branch, getAgentUrl } from "./src/vm/index";

const baseVmId = "9fca551e-9a58-4bf0-b38b-40f5fba90c96";

async function main() {
  // Clone repo into base VM
  console.log("=== Cloning repo into base VM ===");
  await execute(baseVmId, "cd /root && git clone https://github.com/plastic-labs/honcho.git 2>&1");
  const lsResult = await execute(baseVmId, "ls -la /root/honcho | head -10");
  console.log(lsResult.stdout);

  // Branch 5 times
  console.log("\n=== Branching VM 5 times ===");
  const vmIds: string[] = [];
  for (let i = 0; i < 5; i++) {
    const newVmId = await branch(baseVmId);
    vmIds.push(newVmId);
    console.log(`Branch ${i + 1}: ${newVmId.slice(0, 8)} -> ${getAgentUrl(newVmId)}`);
  }

  // Wait for VMs to be ready
  console.log("\n=== Waiting for VMs to boot (5s) ===");
  await new Promise(r => setTimeout(r, 5000));

  // Send typo-finding prompts to all VMs in parallel
  console.log("\n=== Sending typo-finding prompts to all VMs ===");

  const areas = [
    "the Python source code in /root/honcho/src",
    "the documentation and README files in /root/honcho",
    "the test files in /root/honcho/tests",
    "the configuration files (pyproject.toml, etc) in /root/honcho",
    "the API and SDK code in /root/honcho/sdk"
  ];

  await Promise.all(vmIds.map(async (vmId, i) => {
    const url = getAgentUrl(vmId);
    const area = areas[i];

    try {
      // Initialize
      await fetch(`${url}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
      });

      // Create session
      await fetch(`${url}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: {} })
      });

      // Send prompt
      const prompt = `Look for typos, spelling errors, and grammatical mistakes in ${area}. Check variable names, comments, docstrings, and string literals. List each typo you find with the file path, line number if possible, the typo, and the correction.`;

      await fetch(`${url}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "session/prompt", params: { text: prompt } })
      });

      console.log(`[${vmId.slice(0, 8)}] Searching: ${area}`);
    } catch (err) {
      console.log(`[${vmId.slice(0, 8)}] Error: ${err}`);
    }
  }));

  console.log("\n=== All prompts sent! Agents are working... ===");
  console.log("VM IDs:", vmIds.map(id => id.slice(0, 8)).join(", "));

  // Wait for results
  console.log("\n=== Waiting 60s for agents to complete... ===");
  await new Promise(r => setTimeout(r, 60000));

  // Collect results
  console.log("\n=== Collecting results ===\n");

  for (let i = 0; i < vmIds.length; i++) {
    const vmId = vmIds[i];
    if (!vmId) continue;
    const url = getAgentUrl(vmId);
    const area = areas[i];

    try {
      const response = await fetch(`${url}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "session/outputs", params: {} })
      });
      const data = await response.json() as any;
      const outputs = data.result?.outputs || [];
      const textOutputs = outputs.filter((o: any) => o.type === "text").map((o: any) => o.content).join("\n");

      console.log(`\n${"=".repeat(60)}`);
      console.log(`VM ${vmId.slice(0, 8)} - ${area}`);
      console.log("=".repeat(60));
      console.log(textOutputs.slice(0, 2000) + (textOutputs.length > 2000 ? "\n... (truncated)" : ""));
    } catch (err) {
      console.log(`[${vmId.slice(0, 8)}] Error getting results: ${err}`);
    }
  }
}

main().catch(console.error);
