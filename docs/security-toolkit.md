# Daytona security toolkit

OpenMods can install Playwright/Chromium, Nmap, Nikto 2.6.0 and ZAP 2.17.0
inside each bot computer. The agent can invoke them with its existing shell tool.
This is a tool installation foundation, not the full VAPT hackathon workflow.

Set `OPENMODS_SECURITY_TOOLS=true` in the web environment before creating bots.
Creation installs and verifies the toolkit before saving the bot. A failure uses
the existing sandbox cleanup path. The first installation may take several minutes.
Existing bots can be upgraded with:

```sh
node --env-file=.env.local --import tsx scripts/install-sandbox-security-tools.mts
```

The script reads bot IDs from the configured database and verifies each sandbox's
project/environment labels through the existing server helper. Do not run it
against a database or environment you do not intend to update.

Programs:
- `nmap`
- `~/.local/bin/nikto`
- `~/.local/bin/zaproxy` (desktop application, or command-line automation)
- `~/.local/bin/playwright`
- Node library: `~/.local/share/openmods-security/node_modules/playwright`

For Node scripts, run from `~/.local/share/openmods-security` or import the
absolute library path. Playwright includes Chromium for screenshots, interaction
and PDF generation; PDF capability alone does not implement a security report.
The GUI tools can use the existing Daytona computer desktop. Headless browser
operations do not appear in that desktop. Version pins and ZAP SHA-256 live in
`lib/security-toolkit.ts`. A successful install leaves a versioned ready marker;
failed installations can be retried. Logs are inside the sandbox at
`/tmp/openmods-security-install.log`. No API keys are copied into the toolkit.

## Scope and remaining work

Only use organizer-authorized lab targets. Approve a scoped scan plan before
scanning and require explicit human approval before active exploitation. Installing
these binaries does not enforce approval: OpenMods currently exposes a general
shell tool. Before presenting this as an autonomous VAPT product, implement
server-side target scope, approval records tied to an exact action, bounded scanner
adapters, evidence parsing/correlation, risk ranking, review, and PDF reporting.
A prompt instruction is not a security boundary for the general shell.

Nessus needs its own activation/service and disk allocation. OpenVAS/Greenbone is
a multi-service stack with feed storage (official minimum 20 GB disk / 4 GB RAM),
so it does not fit these 3 GB bot computers. Prefer external scanner services and
report import for those. Burp Community can support manual proxy work; automated
scanning requires an appropriate edition/license. Metasploit installation and any
exploitation execution are not included in this baseline. None is claimed integrated.

Daytona's account network policy may restrict access to the organizer's targets.
Confirm target reachability and account resource limits before the demo. This
installer does not alter network restrictions or run scans.

References:
- https://playwright.dev/docs/browsers
- https://www.zaproxy.org/download/
- https://github.com/sullo/nikto/releases
- https://greenbone.github.io/docs/latest/22.4/container/index.html
- https://docs.tenable.com/nessus/Content/HardwareRequirements.htm
- https://www.daytona.io/docs/en/acceptable-use/

## Verification — 2026-11-07

Installed on both existing development bot computers. Nmap, Nikto and ZAP
version checks passed; Playwright launched Chromium and read a local test page.
ZAP's launcher is capped at 512 MB Java heap because its startup script detected
host memory instead of the container allocation. No target scans were performed.
The local `.env.local` enables installation for future bots. Five lifecycle tests,
TypeScript, changed-file lint, and the production build passed. A future-bot
creation was verified with mocks, not by provisioning an additional live sandbox.
Changes are not deployed. The full approval/correlation/reporting workflow remains
outside this installation step.
