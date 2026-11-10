# Selected Drive files: operator setup and unaccepted pilot

Implementation and deterministic fixtures do not establish a real Google installation or recovery pilot. Both acceptance gates remain off until the operator records evidence below. No account, Cloud project, API console, environment, deployment or database change was performed by this task.

## Required isolated Google application

Create a **separate Google Cloud project and OAuth client for Drive**, distinct from the Gmail connector project and client. Do not reuse Gmail keys. Google revocation can affect grants in the same project; separate projects prevent Drive disconnect cleanup from disrupting Mail authorization. The configuration rejects an identical known Gmail client ID, but cannot prove project isolation. The operator must verify the project relationship.

Enable the Drive API and configure an HTTPS web OAuth client. Set these dedicated server environment names: `SCAMWIN_DRIVE_CLIENT_ID`, `SCAMWIN_DRIVE_CLIENT_SECRET`. Set the exact redirect URI to `APP_BASE_URL` + `/api/scamwin/connectors/expanded/drive/callback`. No browser bearer, Google Picker API key, service account or paid fallback is used.

Configure Drive UI integration in that same project: fixed Open URL `APP_BASE_URL` + `/api/scamwin/connectors/drive/open`, OAuth client ID, and supported MIME types. Configure importing/secondary types for Google Workspace exports. Do not register folder/shortcut handling as supported. The server handles both `ids` and Workspace `exportIds` state, and bounded resource keys. State and userId remain untrusted selectors; Auth0 ownership, the saved cryptographically verified Google subject and current server `files.get` access must all match.

Only request `openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.install`. `drive.file` grants provider write authority over opened files; the adapter uses GET-only file reads, metadata, exports and Changes. `drive.install` adds the Open with integration and does not widen file-data access. Whole-Drive scopes, Gmail scopes, browser Picker and folder inheritance are excluded. No content is fetched merely by receiving Open with state: it registers verified encrypted file metadata; the owner must explicitly save selection and import a file, or separately consent to an accepted automatic mode.

## Gates and runtime

All gates default false. Manual connection requires `SCAMWIN_CONNECTORS_ENABLED`, `SCAMWIN_CONNECTOR_DRIVE_ENABLED`, and `SCAMWIN_DRIVE_INSTALLATION_ACCEPTED` to be `true`. Automatic modes additionally require canonical `SCAMWIN_CONNECTOR_AUTOMATION_ENABLED` and `SCAMWIN_DRIVE_AUTOMATION_PILOT_ACCEPTED`. Global registry/runtime, dispatch and free-resource gates still apply. Never set acceptance flags merely because fixtures passed.

Root composition must register the dedicated driver in ExpandedAuthorizationService, register the adapter in the Core runtime provider registry, mount DriveConnectionSetup in the actual Account connection card and include `connectorDriveResources` in isolated connector schema and retention. Schema application requires separate explicit authorization and the connector config; never push against the main database.

## No-fee controlled acceptance evidence

1. Verify project/client isolation, exact callback/Open URLs and consent text. Record account class and visible requested scopes without secrets or raw IDs.
2. Connect from the real Auth0 owner browser; deny consent, retry, expire/replay a callback and try another signed-in Google account. Confirm no connection or selection is accepted from a forged state, mismatched subject or files.get denial. Reconnect must fence the old epoch.
3. Use Drive Open with for a plain text file, PNG/JPEG/WebP and one supported Workspace file. Refresh opened files, explicitly save individual files, import one, and follow the existing source inbox to the staged Core preparation and private result. Verify no content import from Open with alone, no folder-child discovery and no access to unselected files.
4. Confirm unsupported PDF, Office, folders, shortcuts and blocked downloads produce visible gaps. Confirm Workspace export omissions. Test a file larger than 256 KiB text and raster over 10 MiB; neither may claim complete coverage. Image preparation uses the existing four-image and seven-day limits.
5. With automatic acceptance still off, verify both automatic choices reject server-side. Only after authorizing a controlled pilot, enable the automatic pilot gate, select files and consent. Capture the startPageToken activation boundary. Files existing before that boundary are not automatically imported.
6. Edit a selected file, queue a revision, edit again before body retrieval, and verify later bytes are never attributed to the earlier queued version. Changes gives current state, not an archive: intermediate/merged versions remain a coverage gap. Exports verify version and modified time around download; raster attachment download verifies its exact observed version again.
7. Exercise a full 50-change page, checkpoint/restart mid-pagination, provider 401/403/404/410, bounded backoff and a lost grant. An expired Changes token remains a visible gap and requires explicit reactivation; it never silently starts history or skips to a new baseline.
8. Remove/revoke/trash a selected file while its body is queued and before its first save. Confirm durable source suppression, content erasure and cancellation through existing runtime/main-store paths. Same-epoch restoration is not automatic; re-open and save selection to establish a new epoch/boundary. Selected file reference metadata expires after 30 days; reopen expired files explicitly. Expired selection stops polling with a visible unavailable gap, rather than advancing a cursor silently.
9. Disconnect locally first, confirm epoch/grant fencing, then verify bounded fixed Google revocation independently. A remote failure must preserve local disconnect and disclose cleanup is unavailable. Confirm Gmail remains authorized in the separate project. Inspect owner DTOs, model inputs and logs for raw provider IDs, keys, grants or tokens.
10. Record scheduler/drain use under the free allowance, restart recovery, browser-off independence for server Drive polling, and the selected connection's visible omissions. Leave acceptance off if any evidence is missing. No paid runtime is authorized.

## Current coverage limits

Supported bodies: UTF-8 plain text up to 256 KiB; Google Docs/Slides text exports and Sheets CSV exports up to that bound; PNG/JPEG/WebP source images up to 10 MiB through the existing image preparation. Text exports omit formatting, comments, embedded images, charts and potentially document structure; multi-sheet export behavior is provider-defined and not whole-workbook coverage. Original revision archives, PDF/Office parsing, shortcuts, folders, whole-Drive monitoring and binary document parsing are not implemented. No arbitrary webViewLink or downloadUrl is followed.

The deterministic tests cover SQL fencing, selected resources, fixed endpoints, cryptographic Google identity, Changes pages/removals, version races, unsupported coverage, bounded streaming, revoke and gate defaults. Real Auth0/Google OAuth, Google Cloud installation, installed Open with behavior, free-runtime recovery and actual Account browser acceptance remain outstanding.

Official references reviewed 2026-11-10: [Drive Open with](https://developers.google.com/workspace/drive/api/guides/integrate-open), [Drive UI configuration](https://developers.google.com/workspace/drive/api/guides/enable-sdk), [per-file scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [Changes list](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list), [files.get](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/get).
