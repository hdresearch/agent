# Successful vers VM Deployment with Color-Generated Domain

## Deployment Summary

✅ **Successfully deployed vers VM with ngrok tunnel using color MCP domain generation**

### Generated Domain

- **Color**: `#CA3E0E` (crimson)
- **Domain**: `crimson-ca3e-vers.ngrok.io`
- **Seed**: Interaction entropy (7449368709244611695)
- **Invocation**: 1

### VM Configuration

- **VM ID**: `adfd4fd6-1e03-499b-bbd9-27e415665047`
- **Alias**: `test-resources`
- **Memory**: 1024 MB (864 MB available)
- **vCPU**: 2
- **Disk**: 2.0 GB (1.5 GB available)
- **OS**: Ubuntu 24.04

### Installed Components

1. ✅ **Bun runtime** - Installed at `~/.bun/bin/bun`
2. ✅ **ngrok** - Installed at `/usr/local/bin/ngrok` (v3.34.1)
3. ✅ **curl, unzip** - Package dependencies

### ngrok Tunnel Status

```bash
$ curl -I https://crimson-ca3e-vers.ngrok.io
HTTP/2 502
...
ERR_NGROK_8012: agent failed to establish connection to localhost:9999
```

**Status**: ✅ Tunnel active and externally accessible
**Expected behavior**: No service on port 9999 yet (vers-agent not started)

### Key Pattern Confirmed

Following Chelsea's custom image stigmergic traces (PR #702):
- ✅ **Base image only** contains OS + systemd + SSH + networking
- ✅ **Runtime injection** via `vers execute` and `vers copy`
- ✅ **No baked applications** in the image
- ✅ **Lean deployment** with on-demand tool installation

### Domain Generation Pattern

Fixed ngrok subdomain format:
- ❌ `crimson-ca3e.vers.ngrok.io` → Nested subdomain error (ERR_NGROK_354)
- ✅ `crimson-ca3e-vers.ngrok.io` → Valid format

Updated in `src/tunnel/domain-generator.ts`:
```typescript
return `${subdomain}-vers.ngrok.io`;  // Hyphen, not dot
```

### Resource Utilization

| Resource | Allocated | Used | Available | Utilization |
|----------|-----------|------|-----------|-------------|
| Memory   | 1010 MB   | 147 MB | 864 MB | 14.5% |
| CPU      | 2 vCPU    | -    | -         | Idle |
| Disk     | 2.0 GB    | 385 MB | 1.5 GB | 21% |

**Verdict**: Excellent headroom for vers-agent + ACP server workload

### Commands Used

```bash
# 1. Create and configure VM
vers init --name vers-agent --mem-size 1024 --vcpu-count 2 --fs-size-vm 2048
vers run --vm-alias test-resources

# 2. Install dependencies
vers execute <VM_ID> -- apt-get update
vers execute <VM_ID> -- apt-get install --yes curl unzip

# 3. Install Bun
vers copy <VM_ID> /tmp/setup-vm.sh /tmp/setup-vm.sh
vers execute <VM_ID> /tmp/setup-vm.sh

# 4. Install ngrok
vers copy <VM_ID> /tmp/install-ngrok.sh /tmp/install-ngrok.sh
vers execute <VM_ID> /tmp/install-ngrok.sh

# 5. Start ngrok tunnel
vers copy <VM_ID> /tmp/restart-ngrok.sh /tmp/restart-ngrok.sh
vers execute <VM_ID> /tmp/restart-ngrok.sh

# 6. Verify
curl https://crimson-ca3e-vers.ngrok.io
```

### Next Steps

To complete the deployment:

1. **Copy vers-agent binary** (64MB, requires alternative approach due to SCP timeout)
   - Option A: Host on GitHub releases and download in VM
   - Option B: Compress and split for transfer
   - Option C: Build in-VM using Bun

2. **Start vers-agent server**
   ```bash
   vers execute <VM_ID> /tmp/vers-agent --local
   ```

3. **Register in control plane**
   ```bash
   bun src/control/vm-registry.ts add \
     adfd4fd6-1e03-499b-bbd9-27e415665047 \
     test-resources \
     https://crimson-ca3e-vers.ngrok.io \
     online \
     <ngrok-edge-id>
   ```

4. **Test ACP connection**
   ```bash
   curl https://crimson-ca3e-vers.ngrok.io/health
   ```

### Files Created

- `vers.toml` - VM configuration
- `RESOURCE-ANALYSIS.md` - Resource requirements analysis
- `VERS-VM-RESOURCE-CONFIRMATION.md` - Actual resource verification
- `CHELSEA-CUSTOM-IMAGES-ESSENCE.md` - Stigmergic pattern extraction
- `src/tunnel/domain-generator.ts` - Color-to-domain generator
- `scripts/deploy-with-color.sh` - Automated deployment script

### Color MCP Integration

The domain generation leverages color MCP's deterministic color stream:
- **Splittable RNG**: Each invocation gets a unique color
- **Deterministic**: Same seed → same color sequence
- **Interaction entropy**: Seed derived from system state
- **Hex to name**: `#CA3E0E` → `crimson-ca3e`

This ensures:
- Unique subdomains for each deployment
- Reproducible for debugging
- No manual domain management

## Conclusion

✅ **Phase 1 Complete**: VM provisioned, ngrok tunnel active with color-generated domain
🔄 **Phase 2 Pending**: Deploy vers-agent binary and start ACP server
📊 **Resources Confirmed**: Sufficient for full vers-agent + ACP + ngrok stack
