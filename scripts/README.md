# zcode-remote-relay scripts

This directory contains the runtime scripts, policy layer, local ledger, adapter
client, and tests used by the Codex ZCode Remote Relay skill.

## Layers

| Path | Role |
|------|------|
| `src/zcode-remote-client.mjs` | WebSocket client, pairing handshake, bridge open, and RPC calls. |
| `src/rpc-codec.mjs` | Binary value codec and request/response frame helpers. |
| `src/model-policy.mjs` | Model aliases, heuristic routing, and paid-fallback filtering. |
| `src/edit-mode-policy.mjs` | Direct-edit vs patch-only policy and trusted editable roots. |
| `src/pool-policy.mjs` | Worker-count limits and ownership-overlap checks. |
| `src/relay-lock.mjs` | Local mutex for the serial relay control plane. |
| `src/result-schema.mjs` | Structured worker result contract and parser. |
| `src/delegate.mjs` / `src/delegate-utils.mjs` | Hybrid dispatch, bounded wait, auto-collect, and heartbeat handoff. |
| `src/job-store.mjs` | Job, pool, handoff, and result ledger helpers. |
| `src/session-utils.mjs` | Snapshot summarization and message text extraction. |
| `src/dispatch.mjs`, `src/status.mjs`, `src/collect.mjs`, `src/pool-*.mjs` | CLI entry points. |

## Test Suite

The tests use Node's built-in `node:test` runner.

```powershell
cd scripts
npm test
```

Coverage currently includes:

| Suite | Coverage |
|-------|----------|
| `rpc-codec.test.mjs` | Type round-trips, varint boundaries, frame encode/decode, truncation errors, fuzz cases. |
| `edit-mode-policy.test.mjs` | Unsafe auto-trust roots, common-root inference, direct-edit/patch-only matrix. |
| `model-policy.test.mjs` | Alias resolution, heuristic routing, fallback ordering, paid fallback gate. |
| `pool-policy.test.mjs` | Pool type normalization, worker caps, ownership overlap detection. |
| `delegate-utils.test.mjs` | Wait defaults, argument stripping, watch-result classification. |
| `job-store.test.mjs` | Job/pool IDs, marker format, content digest, preview truncation. |
| `result-schema.test.mjs` | Structured JSON extraction and terminal status classification. |
| `session-utils.test.mjs` | Snapshot role counts, model/status fallbacks, message text extraction. |
| `zcode-remote-client.test.mjs` | Fake WebSocket pairing, bridge open, RPC round-trip, and URL redaction. |

## Hybrid Delegate Mode

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
- return `handoff-to-heartbeat` if the wait window expires

Useful knobs:

```powershell
npm run delegate -- --content-file <handoff.md> --wait-ms 900000 --interval-ms 15000
npm run delegate -- --content-file <handoff.md> --no-wait
```

## Structured Result Schema

Workers are asked to finish with the legacy marker:

```text
ZCODE_RELAY_DONE <jobId>
```

They are also asked to include one fenced JSON block:

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
fall back to the marker and runtime state.

## Security Notes

- The ZCode remote URL is a control credential. Keep it in `.env.local`, never
  in reports, chat, screenshots, or worker prompts.
- `model-policy` blocks pay-as-you-go fallback unless
  `ZCODE_ALLOW_PAID_FALLBACK=1` is set explicitly.
- `edit-mode-policy` refuses to auto-trust broad or dangerous roots such as
  drive roots, `Users`, `AppData`, `.ssh`, and system directories.
- Relay control commands are serialized by `relay-control.lock`; do not delete
  the lock unless the holder process is confirmed dead.

## Live Regression

Unit tests do not require a live ZCode session. After a ZCode upgrade, run a
small live regression before relying on the adapter:

```text
prepare -> snapshot -> dispatch read-only ACK -> status -> collect -> mark-result
```
