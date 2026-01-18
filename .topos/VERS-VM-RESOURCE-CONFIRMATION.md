# vers VM Resource Confirmation

## Configuration

From `vers.toml`:
```toml
[machine]
  mem_size_mib = 1024      # 1 GB RAM
  vcpu_count = 2           # 2 virtual CPUs
  fs_size_vm_mib = 2048    # 2 GB filesystem
```

## Actual VM Resources

VM ID: `adfd4fd6-1e03-499b-bbd9-27e415665047`

### Memory
```
               total        used        free      shared  buff/cache   available
Mem:         1010640      146692      906880        3688       60684      863948
Swap:              0           0           0
```
- **Total**: 1010 MB (~1 GB as configured)
- **Available**: 864 MB
- **Used**: 147 MB (14.5%)

### CPU
```
nproc: 2
```
- **vCPUs**: 2 (as configured)

### Disk
```
Filesystem      Size  Used Avail Use% Mounted on
/dev/root       2.0G  385M  1.5G  21% /
```
- **Total**: 2.0 GB (as configured)
- **Used**: 385 MB (21%)
- **Available**: 1.5 GB

## Resource Headroom

| Resource | Allocated | Used | Available | Utilization |
|----------|-----------|------|-----------|-------------|
| Memory   | 1010 MB   | 147 MB | 864 MB | 14.5% |
| CPU      | 2         | -    | -         | - |
| Disk     | 2.0 GB    | 385 MB | 1.5 GB | 21% |

## Verdict: ✅ CONFIRMED SUFFICIENT

The vers VM has **plenty of headroom** for running vers-agent + ngrok + ACP server:

1. **Memory**: 864 MB available >> 400-500 MB peak requirement
2. **CPU**: 2 vCPUs >> 1-1.5 vCPU peak requirement  
3. **Disk**: 1.5 GB available >> 350 MB peak requirement

## Runtime Injection Confirmed

Successfully installed packages via `vers execute`:
- curl, unzip (dependencies)
- apt package manager working correctly
- Network connectivity confirmed (downloaded from archive.ubuntu.com)

## Next Steps

1. ✅ vers VM configuration confirmed
2. ✅ Resource headroom validated
3. ✅ Runtime injection working
4. 🔄 Deploy vers-agent workflow:
   - Install Bun via `vers execute`
   - Copy vers-agent binary to VM
   - Install ngrok
   - Start services
   - Create ngrok edge with generated domain
   - Register in control plane

## Chelsea Custom Image Pattern

From stigmergic analysis (PR #702):
- ❌ DON'T bake application into base image
- ✅ DO inject at runtime via `vers execute`
- Base image should only contain: OS + systemd + SSH + networking

This matches our current approach perfectly.

## Domain Generation

Using color MCP for deterministic domain generation:
- Seed: Interaction entropy (splittable RNG)
- Color: `#CA3E0E` (crimson)
- Domain: `crimson-ca3e.vers.ngrok.io`

This domain is ready for ngrok edge creation and vers-agent deployment.
