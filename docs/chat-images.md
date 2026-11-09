# Chat images and connection fixes

The composer accepts images from **+ → Add photos**, clipboard paste, and drag
and drop. It shows removable thumbnails and supports image-only messages. Images
remain visible in the transcript after a reload and are included when retrying a
reply. The existing developer role, dictation, reply style, and group recipient
controls remain available.

If a reload catches Trigger between the live response ending and its history
save finishing, a bounded background read recovers the completed reply. It stops
on navigation or a new send and never overwrites a newer message or draft.

Up to four PNG, JPEG, WebP, or GIF files can be selected, at most 10 MB each.
The browser converts them to still JPEGs, with a longest edge up to 2048 pixels,
and reduces dimensions/quality as needed to stay within 160 KiB per image.
Four encoded images and the maximum text fit Trigger's per-message size limit.
GIF uploads use a still frame. Validation and preprocessing failures preserve
the draft and previews.

The worker validates the image count, size, base64 encoding, media type and
signature. It accepts inline image data only, so a browser cannot make the worker
fetch an arbitrary URL. The AI SDK converts the file parts for the model, while
Trigger's existing transcript storage saves the user message and its images.
No public upload bucket or database schema change is required.

Desktop and chat-session connection requests use authenticated Route Handlers
that return only connection data. This avoids Server Action responses that
re-render the chat when the rolling Auth0 cookie is renewed. Database form
mutations continue using Server Actions. Ownership is still checked against the
server session, and session/desktop POST requests require a matching origin.
Chat lookups use request-scoped React memoization; recipient validation reuses
the already authorized chat.

Daytona is in `serverExternalPackages` because its Node SDK loads multipart
dependencies with runtime `require()`. Bundling it broke installer uploads even
though the same operation worked directly in Node. Bot creation now identifies
computer/toolkit setup failures separately from database save failures. Installer
diagnostics retain fixed stage names only, never raw provider errors or logs.

Three.js and its types are pinned to 0.182.0 while the stable React Three Fiber
9 renderer still constructs `Clock`. Newer Three.js versions deprecate that
constructor. The [upstream migration discussion](https://github.com/pmndrs/react-three-fiber/issues/3741)
tracks its replacement in Fiber 10. The console is not filtered or patched.

## Local verification

- `npm test`
- `node scripts/check-chat-composer.mjs http://localhost:3101` starts an isolated
  Next.js build with mock Trigger streaming and synthetic local sessions.
- `node scripts/check-create-bot-live.mjs` provisions a real development sandbox
  through the form and removes only its synthetic owner's test resources.
- `node scripts/check-chat-images-live.mjs` uses a running development Trigger
  worker and the configured model to recognize an uploaded test image, then
  verifies that the image and answer reload. It removes its database records.

Run `npm run dev:trigger` alongside `npm run dev` to use the changed worker in
the development environment. Browser checks use synthetic localhost sessions;
they do not exercise real Auth0 OAuth. Live scripts contact Daytona, Trigger,
and/or the configured model and are intentionally separate from `npm test`.
