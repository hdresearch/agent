# Vers Authorization Specification (DRAFT)

> Decentralized, delegable authorization for agents and resources on the Vers platform.

## Overview

This document specifies how Vers uses [UCAN](https://ucan.xyz) (User Controlled Authorization Networks) for agent identity and authorization. The goal is a trustless, open system where:

- Agents can prove their identity without a central authority
- Permissions can be delegated and attenuated
- Anyone can verify authorization without contacting Vers
- The system is open-source and non-proprietary

## Design Principles

1. **No identity lock-in** — Vers doesn't own agent identity; agents own themselves
2. **Cryptographic delegation** — Authority flows through verifiable chains, not database lookups
3. **Attenuation only** — Delegated tokens can have fewer permissions, never more
4. **Stateless verification** — Verify tokens without hitting a central server
5. **Open standard** — Built on UCAN, DIDs, and other open specs

## Agent Identity

Agents are identified by [DIDs](https://www.w3.org/TR/did-core/) (Decentralized Identifiers).

### Ephemeral Agents

For short-lived agents (spawned for a task, then deleted):

```
did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
```

The DID *is* the public key. No registration required. Generate a keypair → you have an identity.

### Persistent Agents

For long-lived agents with human-readable names:

```
did:web:vers.sh:agents:rue
```

Resolves via HTTPS to a DID Document at `https://vers.sh/.well-known/did/agents/rue/did.json`.

### Organizational Agents

Agents belonging to an organization:

```
did:web:vers.sh:orgs:hdresearch:agents:builder-01
```

## Resource URIs

Resources on Vers are identified by URIs following this scheme:

```
vers://<resource-type>/<identifier>[/<sub-resource>]#<action>
```

### Examples

| URI | Meaning |
|-----|---------|
| `vers://vm/abc123` | A specific VM |
| `vers://vm/abc123#read` | Read access to that VM |
| `vers://vm/abc123#write` | Write access (SSH, modify) |
| `vers://vm/abc123#admin` | Full control (delete, snapshot) |
| `vers://vm/*` | All VMs (wildcard) |
| `vers://org/hdresearch/vms/*` | All VMs in an org |
| `vers://api/sessions#create` | Ability to create sessions |
| `vers://commit/sha256-abc123` | A specific immutable commit |

### Action Hierarchy

Actions form a hierarchy where broader actions imply narrower ones:

```
admin
  └── write
        └── read
```

Granting `#admin` implies `#write` and `#read`.

## Token Format (UCAN)

Vers authorization tokens follow the [UCAN 1.0 spec](https://github.com/ucan-wg/spec).

### Structure

```json
{
  "ucv": "1.0.0",
  "iss": "did:key:z6MkAlice...",
  "aud": "did:key:z6MkBob...",
  "exp": 1707357600,
  "nbf": 1707271200,
  "nnc": "abc123",
  "att": [
    {
      "with": "vers://vm/abc123",
      "can": "vm/write"
    },
    {
      "with": "vers://org/hdresearch/vms/*",
      "can": "vm/read"
    }
  ],
  "prf": ["<CID of parent UCAN>"],
  "fct": {
    "vers/issued-by": "did:web:vers.sh:orgs:hdresearch",
    "vers/purpose": "ci-pipeline"
  }
}
```

### Fields

| Field | Description |
|-------|-------------|
| `ucv` | UCAN version |
| `iss` | Issuer DID (who's granting this) |
| `aud` | Audience DID (who's receiving this) |
| `exp` | Expiration (Unix timestamp) |
| `nbf` | Not before (optional) |
| `nnc` | Nonce (replay protection) |
| `att` | Capabilities (what you can do) |
| `prf` | Proofs (chain of parent UCANs) |
| `fct` | Facts (optional metadata) |

### Signing

Tokens are signed JWTs using the issuer's private key. Algorithm: `EdDSA` (Ed25519) recommended.

## Delegation

### Basic Delegation

Alice (org admin) delegates VM creation to Bob (agent):

```
Alice's UCAN:
  iss: did:key:zAlice
  aud: did:key:zBob
  att: [{ with: "vers://org/hdresearch/vms/*", can: "vm/create" }]
  prf: [<root capability from Vers>]
```

Bob can now create VMs. Bob's requests include this UCAN as proof.

### Sub-delegation (Attenuation)

Bob delegates *read-only* access to Carol:

```
Bob's UCAN to Carol:
  iss: did:key:zBob
  aud: did:key:zCarol
  att: [{ with: "vers://org/hdresearch/vms/*", can: "vm/read" }]  // Attenuated!
  prf: [<Alice's UCAN to Bob>]
```

Carol can read, but not create or write. The chain is verifiable:
`Vers root → Alice → Bob → Carol`

### Distributed Issuance

If both Alice and Bob know the org's signing key, both can independently issue valid tokens. Tokens include `iss` to track who issued what.

## Verification

To verify a UCAN:

1. **Check signature** — Token is signed by `iss`
2. **Check expiration** — `exp` > now, `nbf` < now (if present)
3. **Check delegation chain** — Follow `prf` back to a root authority
4. **Check attenuation** — Each step in chain has ≤ parent's permissions
5. **Check resource ownership** — Root authority actually controls the resource

Steps 1-4 are stateless. Step 5 may require checking with the resource (e.g., "does Vers recognize this org?").

## Revocation

Two mechanisms:

### Soft Expiry

Set short `exp` times. Tokens naturally expire. Refresh by requesting new delegation.

**Default TTLs:**
- Agent session tokens: 1 hour
- CI/automation tokens: 24 hours
- Long-lived service tokens: 7 days (require explicit refresh)

### Hard Revocation

For immediate revocation, Vers maintains a lightweight revocation list:

```
POST /api/v1/revoke
{
  "ucan_cid": "bafyrei...",
  "reason": "compromised"
}
```

Verifiers SHOULD check the revocation list for high-value operations. The list is:
- Publicly queryable
- Eventually consistent (propagation delay acceptable)
- Append-only (revocations are permanent)

## Agent Spawning

When an agent spawns a sub-agent:

1. Parent agent generates keypair for child
2. Parent delegates attenuated UCAN to child's DID
3. Child operates with delegated authority
4. Parent can revoke child's UCAN at any time

```
Parent (did:key:zParent)
    │
    │ delegates: vers://vm/abc123#write
    │            vers://api/sessions#create
    ▼
Child (did:key:zChild)
    │
    │ delegates: vers://vm/abc123#read  (attenuated)
    ▼
Grandchild (did:key:zGrandchild)
```

Lineage is encoded in the proof chain. "Who spawned this agent?" → Follow the `prf` chain.

## Integration with Existing Systems

### OAuth2 Bridge

For systems that expect OAuth2:

```
POST /api/v1/oauth/token
Authorization: Bearer <UCAN>

Response:
{
  "access_token": "<short-lived JWT for legacy systems>",
  "token_type": "Bearer",
  "expires_in": 3600
}
```

### API Key Migration

Existing API keys can be exchanged for UCANs:

```
POST /api/v1/auth/upgrade
Authorization: Bearer <legacy API key>

Response:
{
  "ucan": "<new UCAN token>",
  "did": "did:key:z6Mk..."
}
```

## Open Questions

- [ ] Should we support `did:pkh` (blockchain addresses) for users who want that?
- [ ] How do we handle capability discovery? ("What can I do?")
- [ ] Should facts (`fct`) include billing/metering metadata?
- [ ] Revocation list format — use UCAN Revocation spec or custom?
- [ ] Rate limiting per-DID vs per-UCAN?

## References

- [UCAN Specification](https://github.com/ucan-wg/spec)
- [UCAN Delegation](https://github.com/ucan-wg/delegation)
- [UCAN Revocation](https://github.com/ucan-wg/revocation)
- [W3C DID Core](https://www.w3.org/TR/did-core/)
- [did:key Method](https://w3c-ccg.github.io/did-method-key/)
- [did:web Method](https://w3c-ccg.github.io/did-method-web/)
- [Macaroons Paper](https://research.google/pubs/macaroons-cookies-with-contextual-caveats-for-decentralized-authorization-in-the-cloud/)
- [Capability Myths Demolished](https://srl.cs.jhu.edu/pubs/SRL2003-02.pdf)

---

*This is a living document. Comments and contributions welcome.*
