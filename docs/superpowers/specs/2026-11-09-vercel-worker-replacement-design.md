# Vercel investigation replacement

Approved direction: the user selected Vercel background execution for the one-hour, fully online, zero-spend demo on 2026-11-09.

Use Next.js `after()` on the existing Vercel deployment, with Fluid Compute and a 300-second invocation limit. Keep the existing 240-second investigation deadline, Auth0 ownership, Neon evidence and outbox, and Cloudflare Workers AI. Browserless remains the remote browser; no local browser process or paid fallback is introduced.

An explicit `SCAMWIN_INVESTIGATION_BACKEND=vercel` selects this backend; the existing Trigger backend remains optional. Save the check before scheduling its callback. Acknowledge one leased investigation delivery within its 60-second outbox lease before executing the existing pipeline. Existing generation, revision, cancellation, deletion and deadline fencing remain authoritative. Permit at most two active checks globally at admission to bound concurrent free browser use. Owner-authenticated result polling may nudge pending delivery when a callback was never started.

This is bounded execution, not a durable execution service. Neon keeps results; invocation termination may leave a check incomplete until its existing five-minute expiry marks it failed. No automatic paid upgrade or unbounded retries. Publication jobs remain separate and never import a signing key into Vercel investigations. Expired private records remain inaccessible; daily authenticated Vercel maintenance can physically purge them.

For browser validation, add self-contained fictional demo pages on the operator-owned production origin. Keep live browsing disabled until actual Browserless collection verifies containment, evidence capture and session closure. All other origins remain blocked.

Validate backend selection, scope separation, duplicate delivery, stale leases, cancellation/deletion, global admission, runner failure, existing pipeline tests, TypeScript and production build. A production smoke still requires environment configuration, deployment and a signed-in user check.
