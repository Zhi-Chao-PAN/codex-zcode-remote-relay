# zcode-remote-relay — scripts

The local relay that lets Codex act as commander while ZCode (driven through its
Web Remote Control channel) executes bounded worker tasks. Codex owns
architecture, task framing, safety checks, and acceptance; ZCode consumes its own
model quota on well-scoped subtasks.

This directory holds the runtime scripts, the reverse-engineered RPC codec, the
policy layer, and the test suite.

## Architecture

```
Codex thread
  │  bounded handoff prompt (objective / owned files / constraints / stop condition)
  ▼
zcode-remote-relay skill  ──►  prepare / doctor / snapshot
  │
  │  ZCode Web Remote Control (WSS, reverse-engineered)
  ▼
ZCodeRemoteClient  ──►  auth_init → auth_challenge → HMAC proof → auth_ack → paired
  │                     openBridge → rpc(channel, method, args)
  ▼
ZCode task (MiniMax-M3 / glm-5.2 / explicit DeepSeek)
  │
  │  status / collect / pool-collect  (serial, mutex-guarded)
  ▼
Codex review, integration gate, mark-result (accepted / amended / rejected)
```

### Layers

| Path | Role |
|------|------|
| `src/zcode-remote-client.mjs` | WebSocket client + handshake + RPC framing. The wire layer. |
| `src/rpc-codec.mjs` | Binary value codec (varint + type tags) and `encodeRequest`/`decodeResponse`. Reverse-engineered from the ZCode web bundle. |
| `src/model-policy.mjs` | Model registry, alias resolution, heuristic routing, **pay-as-you-go fallback gate**. |
| `src/edit-mode-policy.mjs` | Trusted-edit-root whitelist, `isSafeAutoTrustRoot` deny-list, `resolveEditMode` (direct-edit / patch-only / read-only). |
| `src/pool-policy.mjs` | Worker-count limits per pool type, `validateWorkerOwnership` overlap detection. |
| `src/relay-lock.mjs` | File-mutex for the serial control plane (`fs.openSync('wx')` + stale detection). |
| `src/result-schema.mjs` | Structured worker result contract (`zcode-relay-result/v1`) and parser. |
| `src/delegate.mjs` / `src/delegate-utils.mjs` | Hybrid orchestration: dispatch, bounded in-turn wait, auto-collect, heartbeat handoff on timeout. |
| `src/job-store.mjs` | Job/pool/handoff/result ledger under `~/.codex/zcode-remote-relay/`. |
| `src/session-utils.mjs` | Snapshot summarization + `extractMessageText` (used by `collect` to detect completion). |
| `src/dispatch.mjs` / `status.mjs` / `collect.mjs` / `pool-*.mjs` / `prepare.mjs` | CLI entry points. |

## ⚠️ Stability caveat — undocumented protocol coupling

This relay talks to ZCode through an **internal, undocumented protocol**
(auth handshake, RPC frame format, bridge/session lifecycle). It is not a
public API. Consequences:

- Any ZCode update that changes the auth flow, RPC codec, or bridge protocol can
  **silently break** the relay with no contract or version warning.
- The RPC codec's varint/type-tag layout is reconstructed from the ZCode web
  bundle; a protocol change that alters frame layout will produce silently
  malformed frames rather than a clean error.
- Treat the whole wire layer as **experimental and version-coupled**. When a
  relay call starts timing out or returning malformed payloads after a ZCode
  upgrade, re-derive the codec from the current bundle before assuming a logic
  bug. See `work/zcode-remote-bridge-poc/tools/` (asar extraction + bundle) for
  the reverse-engineering tooling.

If ZCode ever exposes an official Remote Control / MCP / webhook API, the wire
layer (`zcode-remote-client.mjs` + `rpc-codec.mjs`) should be replaced rather
than maintained alongside the reverse-engineered one.

## Tests

The suite is zero-dependency (Node's built-in `node:test`) and covers the
pure/policy layers that are safe to test without a live ZCode connection:

```powershell
cd C:\Users\22304\.codex\skills\zcode-remote-relay\scripts
npm test
# or directly:
node --test "tests/**/*.test.mjs"
```

Coverage:

| Suite | What it locks down |
|-------|--------------------|
| `rpc-codec.test.mjs` | Round-trip of every type, varint boundaries (127/128, 32-bit), frame encode/decode, truncation/unsupported-type errors, 200-case fuzz. |
| `edit-mode-policy.test.mjs` | `isSafeAutoTrustRoot` deny-list (Users/AppData/.ssh/...), `inferCommonRoot`, full `resolveEditMode` matrix, trusted-root persistence round-trip, dry-run safety. |
| `model-policy.test.mjs` | Alias resolution, heuristic routing, `fallbackModelKeys` ordering, **paid-fallback filtering** (default off, env-gated), registry integrity. |
| `pool-policy.test.mjs` | Pool-type normalization, worker-count limits (2/3/4/5+ matrix), ownership-overlap detection (case-insensitive). |
| `delegate-utils.test.mjs` | Hybrid wait defaults, argument stripping, and watch-result classification. |
| `job-store.test.mjs` | `zjob_`/`zpool_` id shape + uniqueness, marker format, sha256 digest correctness, preview truncation. |
| `result-schema.test.mjs` | Structured result prompt, schema normalization, fenced JSON extraction, latest-result selection, terminal status classification. |
| `session-utils.test.mjs` | `summarizeSnapshot` role counting + field fallbacks, `extractMessageText` shape matrix (the completion detector `collect` relies on). |
| `zcode-remote-client.test.mjs` | Fake WebSocket integration for auth challenge/ack, workspace-list, bridge-open, RPC frame round-trip, and URL redaction. |

## Structured result schema

New dispatches still include the legacy completion marker:

```text
ZCODE_RELAY_DONE <jobId>
```

They also ask the worker to include exactly one fenced JSON result block:

```json
{
  "schema": "zcode-relay-result/v1",
  "jobId": "<jobId>",
  "status": "completed",
  "summary": "One concise paragraph.",
  "changedFiles": [],
  "inspectedFiles": [],
  "commands": [],
  "risks": [],
  "nextStep": "none",
  "suggestedNextRound": "none"
}
```

`status.mjs` and `collect.mjs` prefer the structured result when present, then
fall back to the legacy marker and runtime state. This is intentionally
backward-compatible with existing jobs.

## Hybrid delegate mode

For normal Codex -> ZCode work, prefer:

```powershell
npm run delegate -- --content-file <handoff.md>
```

This wraps:

```text
dispatch -> bounded watch -> collect
```

Defaults:

- wait up to 15 minutes
- poll every 15 seconds
- auto-collect completed jobs
- return `blocked-in-turn` if ZCode needs input
- return `handoff-to-heartbeat` if the wait window expires and the heartbeat monitor should recover it later

Useful knobs:

```powershell
npm run delegate -- --content-file <handoff.md> --wait-ms 900000 --interval-ms 15000
npm run delegate -- --content-file <handoff.md> --no-wait
```

### Not covered (needs a live connection or is out of scope)

- Real ZCode WebSocket handshake and RPC round-trips against the installed app.
  `zcode-remote-client.test.mjs` covers the local client state machine with a
  fake WebSocket, but an actual ZCode update can still change the undocumented
  server protocol. Run a live regression after ZCode upgrades:
  `prepare -> snapshot -> dispatch ACK -> status -> collect`.
- CLI entry scripts (`dispatch`/`collect`/`prepare`/...) — they orchestrate the
  client + ledger + lock; integration tests would need a live relay.

## Security notes

- The ZCode remote URL (`sid`/`hash`/`mid`) is a **control credential**. Keep it
  in `.env.local`, never in reports/chat/worker prompts. `redactUrl` scrubs it
  from logs.
- `model-policy` blocks pay-as-you-go (DeepSeek) fallback unless
  `ZCODE_ALLOW_PAID_FALLBACK=1` is set explicitly.
- `edit-mode-policy` refuses to auto-trust broad/dangerous roots (drive root,
  `Users`, `AppData`, `.ssh`, ...). Manual `addTrustedEditRoot` is intentionally
  less strict than auto-trust.
- The relay control plane is serial via `relay-control.lock`; do not delete it
  to bypass waits unless the holder process is confirmed dead.
