# Chelsea Actions Flow with Galois Connection Guarantees

## Overview

This document maps every Chelsea action to its position in the Galois adjunction structure, showing how each operation preserves the adjunction laws and GF(3) conservation.

## Chelsea Action Categories



## Detailed Flow: Base Image Creation



## Detailed Flow: VM Creation



## Detailed Flow: VM Commit (Ceiling)



## Galois Laws in Chelsea

### Adjunction Law Verification



### Unit (eta): create_base_snapshot



### Counit (epsilon): restore from commit



## GF(3) Trit Assignment to Chelsea Actions



## DeferAsync as Adjunction Safety

The DeferAsync pattern ensures adjunction laws hold even on failure:



This ensures:
- **Failure safety**: gamma . alpha = id (resources cleaned up)
- **Success safety**: alpha establishes new floor
- **No partial states**: Either full floor or full rollback

## Complete Pipeline with Galois Annotations



## Summary Table

| Chelsea Action | Galois Role | Trit | Inverse |
|----------------|-------------|------|---------|
| create_new_vm | alpha4 (floor) | +1 | delete_vm |
| delete_vm | gamma4 inverse | -1 | create_new_vm |
| pause_vm | morphism | 0 | resume_vm |
| resume_vm | morphism | 0 | pause_vm |
| commit_vm | gamma4 (ceiling) | 0 | create_vm_from_commit |
| create_vm_from_commit | epsilon (counit) | +1 | commit_vm |
| create_base_snapshot | eta (unit) | +1 | (immutable) |
| create_rbd_and_copy | alpha3 (floor) | +1 | (delete image) |
| download_docker_image | alpha3.1 | +1 | - |
| configure_filesystem | alpha3.4 | 0 | - |
| check_vm_allocation | validation | -1 | - |
| list_all_vms | gamma query | 0 | - |
| get_vm_summary | gamma query | 0 | - |
