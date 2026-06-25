# Codex ZCode Remote Relay

Codex ZCode Remote Relay is a local multi-agent orchestration experiment: Codex
acts as the commander, architect, reviewer, and integration gate, while ZCode
workers execute bounded subtasks with configured third-party models.

The project was built to explore a practical question:

> Can an expensive high-reasoning agent conserve its own quota by delegating
> well-scoped execution work to cheaper or prepaid worker models, without giving
> up review quality and safety?

## What It Demonstrates

- Commander/worker task decomposition between two desktop AI agents.
- Bounded handoff prompts with file ownership, constraints, stop conditions, and
  structured worker results.
- Hybrid delegation: dispatch a worker job, wait for a bounded window, collect
  immediately if it finishes, and hand off to a background monitor if it keeps
  running.
- Worker pools with explicit ownership boundaries and serialized relay control.
- Model routing with a prepaid-first policy and paid-fallback guard.
- Direct-edit trust policy for known project roots, with patch-only fallback for
  unknown or risky paths.
- Local job ledgers, result collection, acceptance states, and regression tests.

## Architecture

```text
Codex thread
  |
  | bounded handoff prompt
  v
zcode-remote-relay skill
  |
  | prepare / delegate / status / collect
  v
ZCode Web Remote Control adapter
  |
  | one or more bounded worker tasks
  v
ZCode worker models
  |
  | structured result + completion marker
  v
Codex review, integration gate, tests, accept/amend/reject
```

Codex remains responsible for final decisions. ZCode output is treated as worker
evidence, not as trusted instructions.

## Core Workflow

Most real tasks use the hybrid delegate entry:

```powershell
cd scripts
npm run delegate -- --content-file path\to\handoff.md
```

Default behavior:

- waits up to 15 minutes in the current Codex turn
- polls every 15 seconds
- auto-collects completed jobs
- returns `blocked-in-turn` if the worker needs user input
- returns `handoff-to-heartbeat` if the bounded wait expires

For worker pools:

```powershell
cd scripts
node src\pool-dispatch.mjs --plan path\to\pool-plan.json --dry-run
node src\pool-dispatch.mjs --plan path\to\pool-plan.json
node src\pool-status.mjs --pool <poolId>
node src\pool-collect.mjs --pool <poolId>
node src\pool-report.mjs --pool <poolId>
```

## Model Policy

The default routing policy is prepaid-first:

1. MiniMax-M3 for routine worker tasks, narrow patches, batch scans, tests, and
   first drafts.
2. Volcano `glm-5.2` for higher-reasoning coding, architecture review,
   cross-module analysis, security/performance work, and tricky bugs.
3. DeepSeek only when explicitly requested or when paid fallback is explicitly
   enabled with `ZCODE_ALLOW_PAID_FALLBACK=1`.

## Safety Model

This project assumes local control and local review:

- Remote control URLs, `sid`/`hash` values, API keys, and tokens are never meant
  to be committed.
- Runtime files live outside the repository by default under
  `%USERPROFILE%\.codex\zcode-remote-relay`.
- Relay control commands are serialized with a local lock because the remote
  bridge is fragile under concurrent control calls.
- Editable workers use `direct-edit` only for trusted roots; otherwise they
  fall back to patch-only output for Codex review.
- Codex must inspect diffs and run validation before accepting worker output.

## Tests

The test suite uses Node's built-in `node:test` and does not require a live ZCode
connection for unit and adapter-state-machine coverage.

```powershell
cd scripts
npm test
```

Current local baseline:

```text
138 tests passed
```

Covered areas include:

- RPC codec encoding/decoding and fuzz round-trips
- model aliasing and paid-fallback filtering
- worker-pool limits and ownership overlap detection
- direct-edit trust policy and unsafe root rejection
- structured result parsing and completion detection
- fake WebSocket integration for the remote client state machine

## Limitations

This is not an official ZCode API integration. The adapter talks to an
undocumented local Web Remote Control channel and can break when ZCode changes
its desktop protocol. Treat the wire layer as experimental and version-coupled.

The repository does not include private remote URLs, extracted vendor bundles,
tokens, or local job results.

## Project Status

This is a personal research and portfolio project for practical AI-agent
orchestration. It is usable as a local workflow on the author's machine and is
published as an implementation case study rather than a polished cross-platform
product.
