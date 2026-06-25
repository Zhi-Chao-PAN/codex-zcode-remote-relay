# Security Policy

This project is designed for local experimentation. Do not publish runtime
credentials, remote-control URLs, `sid`/`hash` values, API keys, or worker output
that may contain private repository content.

## Sensitive Files

The following should stay local and are ignored by default:

- `.env`
- `.env.*`
- `.bridge/`
- `jobs/`
- `pools/`
- `handoffs/`
- `results/`
- `*.lock`

Runtime configuration is expected to live outside the repository under:

```text
%USERPROFILE%\.codex\zcode-remote-relay\.env.local
```

## Reporting Issues

If you find a vulnerability in the public code, open a GitHub issue without
including secrets, remote URLs, tokens, screenshots with QR codes, or private
repository content. For credential exposure, rotate the credential first, then
report the affected file path or commit hash.

## Protocol Caveat

The ZCode adapter uses an undocumented local remote-control channel. It is not a
stable public API. A ZCode update may break the adapter or change security
properties. Re-run the live regression flow after ZCode upgrades before trusting
the relay for real work.
