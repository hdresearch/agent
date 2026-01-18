# Resource Requirements Analysis for vers-agent

## Current vers.toml Configuration

```toml
[machine]
  mem_size_mib = 1024      # 1 GB RAM
  vcpu_count = 2           # 2 virtual CPUs
  fs_size_vm_mib = 2048    # 2 GB filesystem
```

## Component Resource Usage

### 1. Bun Runtime
- **Memory**: ~30-50 MB base
- **CPU**: Minimal when idle, bursts during requests
- **Disk**: ~90 MB

### 2. Claude Code Standalone Binary
- **Memory**: ~100-200 MB when active
- **CPU**: Heavy during code execution (0.5-1 vCPU)
- **Disk**: ~50 MB binary

### 3. ngrok
- **Memory**: ~20-30 MB
- **CPU**: Minimal (~0.1 vCPU for tunnel)
- **Disk**: ~15 MB binary

### 4. vers-agent Application
- **Memory**: ~50-100 MB (Node.js/TypeScript runtime)
- **CPU**: 0.2-0.5 vCPU for ACP protocol handling
- **Disk**: ~20 MB bundled code

### 5. Alpine Base + Dependencies
- **Memory**: ~10 MB
- **Disk**: ~165 MB total image size

## Total Resource Estimates

### Peak Usage (all components active)
- **Memory**: ~400-500 MB peak
- **CPU**: 1-1.5 vCPU during active code execution
- **Disk**: ~350 MB (165 MB image + logs/data)

### Idle Usage
- **Memory**: ~100-150 MB
- **CPU**: 0.1-0.2 vCPU
- **Disk**: ~200 MB

## Current Allocation vs Requirements

| Resource | Allocated | Peak Required | Idle Required | Buffer |
|----------|-----------|---------------|---------------|--------|
| Memory   | 1024 MB   | 500 MB        | 150 MB        | 2x     |
| vCPU     | 2         | 1.5           | 0.2           | ✓      |
| Disk     | 2048 MB   | 350 MB        | 200 MB        | 5x     |

## Verdict: ✅ SUFFICIENT

The current vers configuration provides:
- **2x memory buffer** for peak loads
- **Adequate CPU** for concurrent operations
- **5x disk buffer** for logs and temporary files

## Recommendations

### For Production Fleet (10+ VMs)
Consider reducing to conserve resources:
```toml
[machine]
  mem_size_mib = 768       # Still 50% buffer
  vcpu_count = 2           # Keep for responsiveness
  fs_size_vm_mib = 1024    # Sufficient for logs
```

### For Development/Testing
Current settings are ideal:
```toml
[machine]
  mem_size_mib = 1024      # Comfortable for debugging
  vcpu_count = 2           # Responsive during dev
  fs_size_vm_mib = 2048    # Room for experiments
```

### For High-Throughput Scenarios
If handling many concurrent ACP requests:
```toml
[machine]
  mem_size_mib = 2048      # More buffer for concurrent tasks
  vcpu_count = 4           # Better parallelism
  fs_size_vm_mib = 2048    # Same disk OK
```

## Next Steps

1. ✅ Build custom rootfs image with `vers build`
2. Test VM with resource monitoring
3. Run load tests to verify capacity
4. Deploy to fleet with current settings
