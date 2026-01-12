/**
 * Simple test for VM integration
 *
 * Run with: bun src/vm/test.ts
 */

import { createVm, branch, deleteVm, listVms, getAgentUrl } from "./index";
import { bootstrap, stopAgent } from "./bootstrap";

const TEST_PROMPT = "What is 2 + 2? Reply with just the number.";

async function main() {
  console.log("=== VM Integration Test ===\n");

  let rootVmId: string | null = null;
  let forkVmId: string | null = null;

  try {
    // Step 1: Create root VM
    console.log("1. Creating root VM...");
    rootVmId = await createVm({ memSizeMib: 512, vcpuCount: 1 });
    console.log(`   Root VM created: ${rootVmId}\n`);

    // Step 2: Bootstrap vers-agent on root
    console.log("2. Bootstrapping vers-agent on root VM...");
    const rootAgentUrl = await bootstrap(rootVmId);
    console.log(`   Agent running at: ${rootAgentUrl}\n`);

    // Step 3: Fork the VM
    console.log("3. Forking VM...");
    forkVmId = await branch(rootVmId);
    console.log(`   Fork created: ${forkVmId}\n`);

    // Step 4: Bootstrap vers-agent on fork
    console.log("4. Bootstrapping vers-agent on fork...");
    const forkAgentUrl = await bootstrap(forkVmId);
    console.log(`   Agent running at: ${forkAgentUrl}\n`);

    // Step 5: List VMs to verify parent relationship
    console.log("5. Listing VMs...");
    const vms = await listVms();
    const rootVm = vms.find(v => v.vm_id === rootVmId);
    const forkVm = vms.find(v => v.vm_id === forkVmId);
    console.log(`   Root VM parent: ${rootVm?.parent ?? "none"}`);
    console.log(`   Fork VM parent: ${forkVm?.parent}`);
    console.log(`   Parent relationship correct: ${forkVm?.parent === rootVmId}\n`);

    // Step 6: Send prompt to both agents
    console.log("6. Sending prompt to both agents...");
    console.log(`   Prompt: "${TEST_PROMPT}"\n`);

    const [rootResult, forkResult] = await Promise.all([
      sendPrompt(rootAgentUrl, TEST_PROMPT),
      sendPrompt(forkAgentUrl, TEST_PROMPT),
    ]);

    console.log("   Root response:", rootResult);
    console.log("   Fork response:", forkResult);
    console.log("");

    // Step 7: Cleanup
    console.log("7. Cleaning up...");

  } catch (error) {
    console.error("Test failed:", error);
  } finally {
    // Always cleanup VMs
    if (forkVmId) {
      console.log(`   Deleting fork VM ${forkVmId}...`);
      try {
        await deleteVm(forkVmId);
      } catch (e) {
        console.error(`   Failed to delete fork: ${e}`);
      }
    }
    if (rootVmId) {
      console.log(`   Deleting root VM ${rootVmId}...`);
      try {
        await deleteVm(rootVmId);
      } catch (e) {
        console.error(`   Failed to delete root: ${e}`);
      }
    }
    console.log("\n=== Test complete ===");
  }
}

/**
 * Send a prompt to a vers-agent and get the response
 */
async function sendPrompt(agentUrl: string, prompt: string): Promise<string> {
  // Initialize
  const initResponse = await fetch(`${agentUrl}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    }),
  });

  if (!initResponse.ok) {
    throw new Error(`Initialize failed: ${initResponse.status}`);
  }

  // Create session
  const sessionResponse = await fetch(`${agentUrl}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "session/new",
      params: { cwd: "/tmp" },
    }),
  });

  if (!sessionResponse.ok) {
    throw new Error(`Session create failed: ${sessionResponse.status}`);
  }

  const sessionResult = await sessionResponse.json() as { result?: { sessionId?: string } };
  const sessionId = sessionResult.result?.sessionId;

  if (!sessionId) {
    throw new Error("No session ID returned");
  }

  // Send prompt
  const promptResponse = await fetch(`${agentUrl}/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "session/prompt",
      params: {
        sessionId,
        content: prompt,
      },
    }),
  });

  if (!promptResponse.ok) {
    throw new Error(`Prompt failed: ${promptResponse.status}`);
  }

  // For now, just return success - getting the actual response requires SSE
  // TODO: Subscribe to SSE stream and collect response
  return "(prompt sent - SSE response collection not implemented yet)";
}

// Run the test
main();
