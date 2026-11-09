# Tutorial reference

Source: https://github.com/code-with-antonio/ai-teammates/tree/de32f461cc9e0ddf4c5087af07c65cf06df7d683
Video: https://www.youtube.com/watch?v=mQBuZ6Dp0u0

Chapters: durable chat 1:17:21, sandboxes 1:29:43, group chats 1:42:17,
billing 1:56:39, observability 2:03:10.

The reference lib/daytona.ts provisions persistent bot computers; lib/sandbox-tools.ts
implements filesystem, shell, memory and computer use. trigger/chat.ts switches
instructions and tool sandbox at sequential group handoffs. components/desktop-panel.tsx
provides direct-chat VNC. MEMORY.md belongs to each bot, not each conversation.

User excluded billing/subscriptions/caps. Usage must be informational and sampled
sandbox duration labeled approximate. Keep Auth0 rather than reference Clerk.
Source model prices must not be copied for OpenMods' different model.
