# hdresearch/agent justfile
# Local control over remote ACP agents

# Default: show commands
default:
    @just --list

# 🏗️ Build standalone executable
build:
    bun run build

# 🧪 Run tests  
test:
    bun test

# 🔧 Development with hot reload
dev:
    bun run dev

# 🖥️ Start ACP server only (daemon mode)
server port="9999":
    PORT={{port}} ./vers-agent --server

# 💻 Start CLI only (connects to server)
cli:
    ./vers-agent --cli

# 🔗 Connect to remote ACP server
connect url:
    ./vers-agent --url {{url}}

# 🐸 Both server + CLI (default mode)
run:
    ./vers-agent

# 📋 Health check a running server  
health url="http://localhost:9999":
    curl -s {{url}}/health | jq .

# 🔑 Claim a server and get token
claim url="http://localhost:9999":
    curl -s -X POST {{url}}/claim -H "Content-Type: application/json" -H "X-Client-Id: just-cli" | jq .

# 📊 Get metrics from server
metrics url="http://localhost:9999":
    curl -s {{url}}/metrics

# 🧹 Reset server claim (clear auth.db)
reset-claim:
    rm -f ~/.vers-agent/auth.db
    @echo "✅ Claim reset. Next connection will claim the server."

# 🐳 Docker build
docker-build:
    docker build -t vers-agent .

# 🐳 Docker run  
docker-run:
    docker compose up

# === Vers VM Integration ===

# 🚀 Deploy to vers VM
deploy-vm vm_id:
    #!/usr/bin/env bash
    echo "📦 Building..."
    just build
    echo "📤 Copying to VM {{vm_id}}..."
    vers copy {{vm_id}} ./vers-agent /usr/local/bin/vers-agent
    vers execute {{vm_id}} "chmod +x /usr/local/bin/vers-agent"
    echo "✅ Deployed!"

# 🖥️ Start server in VM
vm-server-start vm_id:
    vers execute {{vm_id}} "nohup /usr/local/bin/vers-agent --server > /var/log/vers-agent.log 2>&1 &"
    @echo "✅ Server started on {{vm_id}}:9999"

# 🛑 Stop server in VM
vm-server-stop vm_id:
    vers execute {{vm_id}} "pkill -f vers-agent || true"

# 📋 Check VM server health
vm-health vm_id:
    vers execute {{vm_id}} "curl -s http://localhost:9999/health" | jq .

# 🔗 Connect local CLI to VM (via SSH tunnel)
vm-connect vm_id:
    #!/usr/bin/env bash
    echo "🔗 Tunneling to {{vm_id}}..."
    ssh -L 9999:localhost:9999 -N {{vm_id}}.vm.vers.sh &
    SSH_PID=$!
    sleep 2
    ./vers-agent --url http://localhost:9999
    kill $SSH_PID 2>/dev/null
