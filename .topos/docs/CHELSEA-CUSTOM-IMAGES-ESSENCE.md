# Chelsea Custom Images: Essential Pattern

Distilled from stigmergic traces in hdresearch/chelsea PR #702 and related issues.

## Core Insight

Custom images for vers VMs follow a **minimalist, VM-ready rootfs pattern**:
1. Base OS (Ubuntu 24.04/Alpine)
2. systemd for init
3. SSH server (disabled password auth, pubkey only)
4. Essential networking tools
5. Non-root user with sudo
6. **NO application layer** in base image

The application (vers-agent, ACP server, etc.) is **injected at runtime**, not baked into the image.

## The Essential Dockerfile Pattern

```dockerfile
# VM-ready base image for Firecracker microVMs
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Init + SSH + Networking + Utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    systemd systemd-sysv \
    openssh-server \
    iproute2 iputils-ping net-tools \
    curl wget ca-certificates \
    sudo vim-tiny less \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# SSH: pubkey-only, root login allowed
RUN mkdir -p /run/sshd \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/' /etc/ssh/sshd_config \
    && sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config \
    && systemctl enable ssh

# Non-root user with passwordless sudo
RUN useradd -m -s /bin/bash -G sudo vers \
    && echo 'vers ALL=(ALL) NOPASSWD:ALL' >> /etc/sudoers.d/vers \
    && mkdir -p /root/.ssh /home/vers/.ssh \
    && chmod 700 /root/.ssh /home/vers/.ssh \
    && chown vers:vers /home/vers/.ssh

# Remove unnecessary systemd units (plymouth, etc.)
RUN rm -f /lib/systemd/system/multi-user.target.wants/plymouth* \
    /lib/systemd/system/local-fs.target.wants/plymouth* \
    /lib/systemd/system/basic.target.wants/plymouth* \
    2>/dev/null || true

# Multi-user target (no GUI)
RUN systemctl set-default multi-user.target

CMD ["/sbin/init"]
```

## Build → Export → Upload Flow

```bash
# 1. Build Docker image
docker build -f Dockerfile.lean -t vers-agent-vm .

# 2. Export rootfs (NOT docker save!)
docker export $(docker create vers-agent-vm) -o rootfs.tar

# 3. Convert to squashfs (optional, Chelsea uses this)
unsquashfs rootfs.tar  # OR: mksquashfs rootfs/ rootfs.squashfs

# 4. Upload to Chelsea/vers
curl -X POST https://api.vers.sh/api/v1/images/create \
  -H "Authorization: Bearer $VERS_API_KEY" \
  -d '{
    "image_name": "vers-agent",
    "source": {"type": "docker", "image_ref": "vers-agent-vm"},
    "size_mib": 2048
  }'
```

## What Chelsea Does With Custom Images

Per PR #702 (`crates/chelsea_lib/src/base_image/builder.rs`):

1. **Pull Docker image** via skopeo/podman
2. **Extract rootfs** to temporary directory
3. **Inject Chelsea scripts**:
   - `fcnet-setup.sh` - Firecracker networking
   - `notify-ready.sh` - Health check callback
   - SSH authorized_keys
4. **Convert to squashfs** via `mksquashfs`
5. **Upload to Ceph** object storage
6. **Register in database** with metadata

## Current Known Issues

From hdresearch/chelsea#722:
- ❌ Chelsea orchestrator nodes cannot pull from DockerHub/ghcr.io/quay.io
- ❌ All image creation jobs fail with "Image not found on Chelsea node"
- Hypothesis: Firewall/network egress issue or missing container runtime

Workaround: Bootstrap with default image + install application at runtime.

## Application to vers-agent

### ❌ DON'T: Bake application into image
```dockerfile
# BAD: This is too fat, breaks the pattern
COPY vers-agent /usr/local/bin/
COPY dist/ /app/
RUN bun install
```

### ✅ DO: Minimal base + runtime injection
```dockerfile
# GOOD: Lean base image
FROM alpine:3.19
RUN apk add --no-cache curl openssh systemd sudo

# Application injected later via:
# vers execute $VM_ID -- curl -o /usr/local/bin/vers-agent https://...
# vers execute $VM_ID -- /usr/local/bin/vers-agent --local
```

## For vers Local Workflow

Since vers uses local Docker/container runtime (not Chelsea infrastructure):

1. **Build lean Dockerfile.lean** with systemd + networking
2. **Use vers build** to create rootfs
3. **vers run** with custom rootfs name
4. **Post-boot injection** via `vers execute`:
   ```bash
   vers run --rootfs vers-agent-lean
   VM_ID=$(vers status | grep -o '[0-9a-f-]\{36\}')
   
   # Inject application
   vers execute $VM_ID -- sh -c "
     curl -fsSL https://bun.sh/install | sh
     curl -o /usr/local/bin/vers-agent https://example.com/vers-agent
     chmod +x /usr/local/bin/vers-agent
   "
   
   # Start services
   vers execute $VM_ID -- /usr/local/bin/vers-agent --local &
   vers execute $VM_ID -- ngrok http --authtoken=\$NGROK_AUTHTOKEN 9999 &
   ```

## Key Takeaways

1. **Base image = OS + init + SSH**, nothing more
2. **Application injection happens at runtime**, not build time
3. **squashfs is the final format** for Firecracker VMs
4. **Chelsea's Docker pull is broken**, use fallback bootstrap
5. **vers local workflow** is cleaner: build → vers run → inject → start

## Essential Files to Study

- `hdresearch/chelsea` PR #702
  - `scripts/base-image/Dockerfile.ubuntu-24.04` - Reference pattern
  - `crates/chelsea_lib/src/base_image/builder.rs` - Build orchestration
  - `scripts/test-images.sh` - E2E test workflow
- `hdresearch/duck` Issue #19 - Deployment status report
- `hdresearch/chelsea` Issue #722 - DockerHub pull failure

## Adaptation for vers-agent

Our `Dockerfile.lean` should be refactored to match this pattern:
- ✅ Keep Alpine base + systemd
- ✅ Add SSH server with pubkey auth
- ✅ Create vers user with sudo
- ❌ Remove bun install, dist/, node_modules from image
- ❌ Remove standalone binaries (claude-code, ngrok) from image
- ✅ Inject via `vers execute` after VM boot
