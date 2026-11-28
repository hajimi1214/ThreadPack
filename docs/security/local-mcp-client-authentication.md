# Local MCP client authentication

## Scope

ThreadPack MCP currently uses local `stdio` processes. This credential registry authenticates a registered local client principal by bearer-token possession. It does not authenticate a WorkBuddy, Codex, Claude Code, or other platform account, and it does not identify a human operator.

## Credential lifecycle

- `threadpack mcp-client issue` generates 32 cryptographically random bytes encoded as base64url and prints the token once.
- The JSON registry stores only a SHA-256 token digest, an exact project ID, explicit permissions, timestamps, and revocation state.
- `list` omits both tokens and digests. `rotate` replaces the token and immediately invalidates the former token. `revoke` preserves a timestamped tombstone.
- Registry parsing rejects unknown schema versions, duplicate IDs, malformed permissions, symbolic links, oversized files, and group/other-readable POSIX files.
- Registry updates use a lock file and an atomic temporary-file rename. If a writer crashes and leaves a `.lock` file, an operator must confirm the writer stopped before removing that stale lock.
- The MCP process reads the token from a configurable environment-variable name, never from a command-line token argument. It revalidates the credential and registry grant before each project resource or tool request.

## Authorization model

Every registered client is scoped to one exact project. Read access is granted to registered credentials. Candidate-update and task-coordination grants are independent, and runtime flags can only reduce the registered grants. A backup with another project ID fails closed. Unregistered local read-only instances remain available for compatibility when no `--client-id` is configured. Enabling either write tool requires a registered local client credential.

Candidate updates still enter a separate inbox and require user review before changing project facts. Task claims and historical client labels in the shared inbox remain unsigned coordination data. A runtime-authenticated process does not retroactively authenticate those stored records.

## Storage and limitations

The generated token is a bearer secret. The MCP server accepts it through an environment-variable name beginning with `THREADPACK_`, avoiding accidental replacement of common process variables such as `PATH`. The setup guide can include it in a client configuration `env` map, so the resulting configuration and clipboard history require protection. Prefer a per-user directory with operating-system access controls. POSIX registry files require mode `0600`. On Windows, file creation requests owner-only mode, but Windows ACL inheritance is not inspected or enforced by this version.

The registry is a local authorization file, not a cryptographically signed trust root. A malicious process running as the same OS user may be able to read the client configuration or alter the registry. This design does not provide remote transport, cross-user authorization, network revocation, or OS sandboxing. External MCP client metadata received in `initialize` remains untrusted and is recorded separately from the authenticated local principal.

## Evidence

`tests/mcp.test.ts` covers one-time issue output, hash-only registry storage, hidden token material in list output, exact project scoping, write-grant enforcement, token rotation, revocation, live-session revocation, and unchanged project backups. The actual WorkBuddy, Codex, and Claude Code configuration and model behavior must be verified separately for each supported client version.
