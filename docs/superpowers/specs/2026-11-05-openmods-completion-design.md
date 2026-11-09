# Approved OpenMods completion design

Retain the existing interface and Auth0. Give each bot a persistent Daytona
computer with MEMORY.md, 15-minute auto-stop and no automatic deletion. Clean up
failed provisioning and delete remote computers before bot records. Require
sandbox IDs and apply schema changes with db:push on clean development data.

Expose shell, files, memory, computer input and screenshots through typed durable
Trigger tools. Default command timeout 60s, maximum 600s, 50 steps, generation
budget 15min. Sequential handoffs transfer instructions and computer together;
no repeated participant in a turn. Default recipient is first ordered group
member, explicit nonmembers rejected. Groups require 2+ distinct owned bots and
trimmed names 1–50 characters. Preserve historical author attribution.

Direct-chat noVNC panel is watch-only, fullscreen interactive. Shared computer
across chats; preserve one connection through fullscreen. Authorize expiring
URLs server-side. Preserve dictation, reply style, stop, retry and durable reload.

Track provider tokens and configured cost estimates with idempotent events.
Sample owned running computers every five minutes; label runtime estimated.
No payments, paywalls or account caps. Show current UTC month and all-time usage.

Optional Sentry captures sanitized operational failures and timings, never chat,
commands, screenshots, credentials or raw identities. No replay or locals.
Keep web/worker release identifiers aligned and document rollout and rollback.
