# ACP VM Fleet Management Plan

> One local Claude orchestrates N remote Claude agents via Morph Cloud + vers

**Color:** `#c778ea` | **Trit:** 0 (ERGODIC - Coordination)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LOCAL ORCHESTRATOR                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐│
│  │  Claude (via Amp/CLI)                                               ││
│  │  • Dispatches tasks to remote agents                                ││
│  │  • Collects and synthesizes results                                 ││
│  │  • Manages VM lifecycle (create/branch/delete)                      ││
│  └──────────────────────────┬──────────────────────────────────────────┘│
└─────────────────────────────┼───────────────────────────────────────────┘
                              │ vers execute / ACP HTTP
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
   ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
   │  acp-alpha  │     │  acp-beta   │     │  acp-gamma  │
   │  16GB / 8GB │     │  16GB / 8GB │     │  16GB / 8GB │
   │  trit: -1   │     │  trit: 0    │     │  trit: +1   │
   │  VALIDATOR  │     │ COORDINATOR │     │  GENERATOR  │
   └─────────────┘     └─────────────┘     └─────────────┘
        │                   │                   │
        └───────────────────┴───────────────────┘
                    Morph Cloud VMs
```

---

## Phase 1: VM Creation

### 1.1 Create Base VM

```bash
# Create base VM with adequate resources
vers run -N acp-base --fs-size-vm 16384 --mem-size 8192

# Install dependencies
VM_ID=$(vers alias acp-base)
vers execute "$VM_ID" "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs npm curl jq"

# Install Claude Code
vers execute "$VM_ID" "npm install -g @anthropic-ai/claude-code"

# Verify
vers execute "$VM_ID" "claude --version"
# → 2.1.2 (Claude Code)
```

### 1.2 Inject API Key

```bash
# Create key file locally
echo "$ANTHROPIC_API_KEY" > /tmp/anthropic_key.txt

# Copy to VM
vers copy "$VM_ID" /tmp/anthropic_key.txt /tmp/anthropic_key.txt

# Set in environment
vers execute "$VM_ID" 'KEY=$(cat /tmp/anthropic_key.txt | tr -d "\n") && echo "export ANTHROPIC_API_KEY=$KEY" >> ~/.bashrc'

# Clean up local key file
rm /tmp/anthropic_key.txt
```

### 1.3 Deploy ACP Server

```bash
# Copy ACP server script
vers copy "$VM_ID" ./scripts/acp-server.js /opt/acp-server.js

# Start server
vers execute "$VM_ID" "source ~/.bashrc && nohup node /opt/acp-server.js > /var/log/acp.log 2>&1 &"

# Verify
vers execute "$VM_ID" "curl -s http://localhost:9999/health"
# → {"status":"ok","claude":"2.1.2"}
```

### 1.4 Fork to Fleet

```bash
# Create triadic fleet from base
vers branch acp-base --alias acp-alpha   # trit: -1 (Validator)
vers branch acp-base --alias acp-beta    # trit:  0 (Coordinator)  
vers branch acp-base --alias acp-gamma   # trit: +1 (Generator)

# Or create fresh with larger resources
for ALIAS in acp-alpha acp-beta acp-gamma; do
  vers run -N "$ALIAS" --fs-size-vm 16384 --mem-size 8192
done
```

---

## Phase 2: Fleet Configuration

### 2.1 Triadic Identity Assignment

Each VM receives a configuration file defining its role:

```bash
# acp-alpha: Validator (trit: -1)
vers execute acp-alpha 'cat > /etc/acp-agent.json << EOF
{
  "name": "alpha",
  "trit": -1,
  "role": "validator",
  "color": "#E74C3C",
  "prompt": "You are a rigorous validator. Question everything. Find flaws. Contract the solution space."
}
EOF'

# acp-beta: Coordinator (trit: 0)
vers execute acp-beta 'cat > /etc/acp-agent.json << EOF
{
  "name": "beta",
  "trit": 0,
  "role": "coordinator",
  "color": "#F39C12",
  "prompt": "You are a coordinator. Route efficiently. Transform inputs. Balance competing concerns."
}
EOF'

# acp-gamma: Generator (trit: +1)
vers execute acp-gamma 'cat > /etc/acp-agent.json << EOF
{
  "name": "gamma",
  "trit": 1,
  "role": "generator",
  "color": "#27AE60",
  "prompt": "You are a generator. Create new possibilities. Expand the solution space. Synthesize ideas."
}
EOF'
```

### 2.2 Verify Fleet Health

```bash
# Health check all VMs
for ALIAS in acp-alpha acp-beta acp-gamma; do
  echo -n "$ALIAS: "
  vers execute "$ALIAS" "curl -s http://localhost:9999/health | jq -c ."
done
```

Expected output:
```
acp-alpha: {"status":"ok","claude":"2.1.2"}
acp-beta: {"status":"ok","claude":"2.1.2"}
acp-gamma: {"status":"ok","claude":"2.1.2"}
```

---

## Phase 3: Model-Driven Management

### 3.1 Dispatch Pattern (Babashka)

```clojure
#!/usr/bin/env bb
;; acp-dispatch.bb - Dispatch tasks to ACP fleet

(require '[babashka.process :refer [shell]]
         '[cheshire.core :as json])

(def FLEET
  [{:alias "acp-alpha" :trit -1 :role "validator"}
   {:alias "acp-beta"  :trit  0 :role "coordinator"}
   {:alias "acp-gamma" :trit  1 :role "generator"}])

(defn vers-execute [alias cmd]
  (-> (shell {:out :string :err :string :continue true}
             "vers" "execute" alias cmd)
      :out))

(defn acp-prompt [alias text]
  "Send prompt to ACP server on VM"
  (let [cmd (format "source ~/.bashrc && curl -s -X POST http://localhost:9999/prompt -H 'Content-Type: application/json' -d '{\"text\": \"%s\"}'"
                    (clojure.string/escape text {\" "\\\""}))]
    (-> (vers-execute alias cmd)
        (json/parse-string true)
        :result)))

(defn dispatch-to-role [role text]
  "Dispatch to VM by role"
  (let [vm (first (filter #(= (:role %) role) FLEET))]
    (when vm
      (println (format "→ %s (%s): %s" (:alias vm) role (subs text 0 (min 50 (count text)))))
      (acp-prompt (:alias vm) text))))

(defn triadic-dispatch [task]
  "Run task through all three agents in sequence"
  (println "═══ Triadic Dispatch ═══")
  
  ;; Step 1: Generator creates options
  (println "\n[+1] Generator expanding...")
  (let [options (dispatch-to-role "generator" 
                  (str "Generate 3 approaches for: " task))]
    
    ;; Step 2: Coordinator synthesizes
    (println "\n[0] Coordinator routing...")
    (let [synthesis (dispatch-to-role "coordinator"
                      (str "Synthesize and prioritize these approaches:\n" options))]
      
      ;; Step 3: Validator reviews
      (println "\n[-1] Validator checking...")
      (dispatch-to-role "validator"
        (str "Review for flaws and risks:\n" synthesis)))))

;; Usage
(when (seq *command-line-args*)
  (triadic-dispatch (clojure.string/join " " *command-line-args*)))
```

### 3.2 Claude-Driven Orchestration

The local Claude can manage the fleet directly:

```markdown
## Task: Review authentication system

I'll dispatch this to the triadic fleet:

1. **Generator (acp-gamma)**: "Generate 3 alternative authentication architectures"
2. **Coordinator (acp-beta)**: "Synthesize the options into a comparison matrix"  
3. **Validator (acp-alpha)**: "Review for security vulnerabilities"

Running...
```

```bash
# Claude executes via shell
vers execute acp-gamma "source ~/.bashrc && claude --print 'Generate 3 auth architectures: JWT, OAuth2, Session-based. Compare tradeoffs.'"
```

### 3.3 Parallel Dispatch

```bash
# Fan out to all VMs simultaneously
parallel_dispatch() {
  local TASK="$1"
  
  for ALIAS in acp-alpha acp-beta acp-gamma; do
    (
      RESULT=$(vers execute "$ALIAS" "source ~/.bashrc && claude --print '$TASK'")
      echo "=== $ALIAS ===" 
      echo "$RESULT"
    ) &
  done
  wait
}

parallel_dispatch "What is 2+2? Reply with just the number."
```

---

## Phase 4: Lifecycle Management

### 4.1 VM States

```
┌──────────┐     ┌──────────┐     ┌──────────┐
│ Created  │────▶│ Running  │────▶│ Paused   │
└──────────┘     └──────────┘     └──────────┘
                      │                 │
                      ▼                 ▼
                ┌──────────┐     ┌──────────┐
                │ Branched │     │ Deleted  │
                └──────────┘     └──────────┘
```

### 4.2 Commands

| Action | Command |
|--------|---------|
| Create | `vers run -N alias --fs-size-vm 16384 --mem-size 8192` |
| Status | `vers status alias` |
| Execute | `vers execute alias "command"` |
| Copy file | `vers copy alias /local/path /remote/path` |
| Branch | `vers branch alias --alias new-alias` |
| Pause | `vers pause alias` |
| Resume | `vers resume alias` |
| Delete | `vers delete alias` |

### 4.3 Fleet Cleanup

```bash
# Delete entire fleet
for ALIAS in acp-alpha acp-beta acp-gamma acp-base; do
  VM_ID=$(vers alias "$ALIAS" 2>/dev/null)
  if [ -n "$VM_ID" ]; then
    echo "Deleting $ALIAS ($VM_ID)..."
    vers delete "$VM_ID" -y
  fi
done
```

---

## Phase 5: Production Hardening

### 5.1 Persistent ACP Server (systemd)

```bash
vers execute acp-alpha 'cat > /etc/systemd/system/acp-server.service << EOF
[Unit]
Description=ACP Server
After=network.target

[Service]
Type=simple
User=root
EnvironmentFile=/etc/environment
ExecStart=/usr/bin/node /opt/acp-server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable acp-server
systemctl start acp-server'
```

### 5.2 API Key in /etc/environment

```bash
vers execute acp-alpha 'KEY=$(cat /tmp/anthropic_key.txt | tr -d "\n")
echo "ANTHROPIC_API_KEY=$KEY" >> /etc/environment'
```

### 5.3 Expose via ngrok

```bash
# Install ngrok on VM
vers execute acp-alpha "curl -fsSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz | tar xz -C /usr/local/bin"

# Start tunnel
vers execute acp-alpha "NGROK_AUTHTOKEN=$NGROK_AUTHTOKEN nohup ngrok http 9999 > /var/log/ngrok.log 2>&1 &"

# Get public URL
vers execute acp-alpha "curl -s localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url'"
```

---

## Quick Reference

### Create Fleet (One Command)

```bash
#!/bin/bash
# create-acp-fleet.sh

ALIASES=("acp-alpha" "acp-beta" "acp-gamma")
DISK=16384  # 16GB
MEM=8192    # 8GB

for ALIAS in "${ALIASES[@]}"; do
  echo "Creating $ALIAS..."
  vers run -N "$ALIAS" --fs-size-vm $DISK --mem-size $MEM
  
  VM_ID=$(vers alias "$ALIAS")
  vers execute "$VM_ID" "apt-get update && apt-get install -y nodejs npm"
  vers execute "$VM_ID" "npm install -g @anthropic-ai/claude-code"
  
  # Copy key and server
  vers copy "$VM_ID" /tmp/anthropic_key.txt /tmp/anthropic_key.txt
  vers copy "$VM_ID" ./acp-server.js /opt/acp-server.js
  
  # Configure and start
  vers execute "$VM_ID" 'KEY=$(cat /tmp/anthropic_key.txt | tr -d "\n") && echo "export ANTHROPIC_API_KEY=$KEY" >> ~/.bashrc'
  vers execute "$VM_ID" "source ~/.bashrc && nohup node /opt/acp-server.js &"
  
  echo "✅ $ALIAS ready"
done

echo "Fleet created!"
```

### Fleet Status

```bash
for ALIAS in acp-alpha acp-beta acp-gamma; do
  printf "%-12s " "$ALIAS:"
  vers execute "$ALIAS" "curl -s localhost:9999/health" 2>/dev/null || echo "offline"
done
```

### Prompt All

```bash
PROMPT="What is 2+2?"
for ALIAS in acp-alpha acp-beta acp-gamma; do
  echo "=== $ALIAS ==="
  vers execute "$ALIAS" "source ~/.bashrc && claude --print '$PROMPT'" 2>/dev/null
done
```

---

## GF(3) Conservation

The fleet maintains balance:

| VM | Trit | Role | Color |
|----|------|------|-------|
| acp-alpha | -1 | Validator | `#E74C3C` |
| acp-beta | 0 | Coordinator | `#F39C12` |
| acp-gamma | +1 | Generator | `#27AE60` |

**Sum:** `-1 + 0 + 1 = 0` ✓

Each task flows through all three for balanced output.
