import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertConnectorDatabaseUrl } from './check-scamwin-connector-database.mjs';

const providers = ['gmail', 'outlook', 'telegram', 'slack', 'teams', 'discord', 'drive', 'extension'];
const flags = ['SCAMWIN_CONNECTORS_ENABLED', 'SCAMWIN_CONNECTOR_RUNTIME_ENABLED', 'SCAMWIN_CONNECTOR_AUTOMATION_ENABLED', 'SCAMWIN_PRIVATE_PUSH_ENABLED', 'SCAMWIN_ALTERNATIVES_ENABLED', 'SCAMWIN_GMAIL_PUBLIC_ELIGIBLE', 'SCAMWIN_GMAIL_TEST_USER_PILOT', 'SCAMWIN_SLACK_FILES_ENABLED', 'SCAMWIN_SLACK_COVERAGE_PILOT_ACCEPTED', 'SCAMWIN_TEAMS_AUTOMATION_PILOT_ACCEPTED', 'SCAMWIN_DRIVE_INSTALLATION_ACCEPTED', 'SCAMWIN_DRIVE_AUTOMATION_PILOT_ACCEPTED', ...providers.map(provider => `SCAMWIN_CONNECTOR_${provider.toUpperCase()}_ENABLED`)];
const hexKey = value => typeof value === 'string' && /^[a-fA-F0-9]{64}$/.test(value);
const present = value => typeof value === 'string' && value.length > 0 && value.trim() === value;

/** Offline shape/configuration inspection. No environment files, network or SQL. */
export function inspectConnectorConfiguration(env) {
  const checks = [], providerResults = {};
  const enabled = key => env[key] === 'true';
  const add = (key, ok, reason) => { checks.push({ key, ok: Boolean(ok), reason: ok ? 'valid_configuration' : reason }); return Boolean(ok); };
  const requireValue = (key, max = 16384) => add(key, present(env[key]) && env[key].length <= max, 'missing_or_invalid_value');
  for (const key of flags) if (env[key] !== undefined) add(key, env[key] === 'true' || env[key] === 'false', 'expected_true_or_false');
  for (const key of Object.keys(env)) {
    const obsolete = /^(?:CONNECTORS_ENABLED|CONNECTOR_EXTENSION_ENABLED|CONNECTOR_AUTOMATION_ENABLED|PRIVATE_PUSH_ENABLED)$/.test(key)
      || /^SCAMWIN_.*(?:_OAUTH_ENABLED|_AUTOMATIC_ENABLED)$/.test(key) || /^(?:SCAMWIN_)?PUSH_VAPID_/.test(key)
      || /^SCAMWIN_(?:GMAIL|OUTLOOK)_CLIENT_(?:ID|SECRET)$/.test(key);
    if (obsolete && present(env[key])) add(key, false, 'obsolete_setting');
  }
  const global = enabled('SCAMWIN_CONNECTORS_ENABLED'), push = enabled('SCAMWIN_PRIVATE_PUSH_ENABLED');
  let origin = null, shared = false;
  if (global || push) {
    try { const url = new URL(env.APP_BASE_URL); if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error(); origin = url.origin; } catch { /* Never return parser errors containing supplied values. */ }
    add('APP_BASE_URL', origin !== null, 'expected_exact_https_origin');
    try { assertConnectorDatabaseUrl(env.SCAMWIN_CONNECTOR_DATABASE_URL, env.DATABASE_URL); add('SCAMWIN_CONNECTOR_DATABASE_URL', true); } catch { add('SCAMWIN_CONNECTOR_DATABASE_URL', false, 'expected_isolated_connector_database'); }
    add('SCAMWIN_CONNECTOR_ENCRYPTION_KEY', hexKey(env.SCAMWIN_CONNECTOR_ENCRYPTION_KEY), 'expected_32_byte_hex_key');
    add('SCAMWIN_CONNECTOR_IDENTIFIER_KEY', hexKey(env.SCAMWIN_CONNECTOR_IDENTIFIER_KEY) && env.SCAMWIN_CONNECTOR_IDENTIFIER_KEY.toLowerCase() !== env.SCAMWIN_CONNECTOR_ENCRYPTION_KEY?.toLowerCase(), 'expected_distinct_32_byte_hex_key');
    add('SCAMWIN_CONNECTOR_DISPATCH_SECRET', present(env.SCAMWIN_CONNECTOR_DISPATCH_SECRET) && env.SCAMWIN_CONNECTOR_DISPATCH_SECRET.length >= 32 && env.SCAMWIN_CONNECTOR_DISPATCH_SECRET.length <= 4096
      && ![env.SCAMWIN_CONNECTOR_ENCRYPTION_KEY?.toLowerCase(), env.SCAMWIN_CONNECTOR_IDENTIFIER_KEY?.toLowerCase()].includes(env.SCAMWIN_CONNECTOR_DISPATCH_SECRET?.toLowerCase()), 'expected_dedicated_dispatch_secret');
    const version = env.SCAMWIN_CONNECTOR_ENCRYPTION_KEY_VERSION ?? 'k1';
    add('SCAMWIN_CONNECTOR_ENCRYPTION_KEY_VERSION', typeof version === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(version) && version !== 'identifier', 'invalid_key_version');
    if (env.SCAMWIN_CONNECTOR_PREVIOUS_ENCRYPTION_KEYS) {
      let valid = false;
      try { const previous = JSON.parse(env.SCAMWIN_CONNECTOR_PREVIOUS_ENCRYPTION_KEYS); valid = previous !== null && typeof previous === 'object' && !Array.isArray(previous) && Object.keys(previous).length <= 5 && Object.entries(previous).every(([name, value]) => name !== version && name !== 'identifier' && /^[a-zA-Z0-9_-]{1,40}$/.test(name) && hexKey(value)); } catch { /* Deliberately omit JSON errors. */ }
      add('SCAMWIN_CONNECTOR_PREVIOUS_ENCRYPTION_KEYS', valid, 'invalid_previous_key_inventory');
    }
    shared = checks.every(check => check.ok);
  }
  for (const provider of providers) {
    const requested = enabled(`SCAMWIN_CONNECTOR_${provider.toUpperCase()}_ENABLED`), start = checks.length;
    if (requested) {
      const prefix = provider === 'gmail' ? 'GOOGLE' : provider === 'outlook' ? 'MICROSOFT' : provider.toUpperCase();
      if (provider !== 'extension') { requireValue(`SCAMWIN_${prefix}_CLIENT_ID`, 512); requireValue(`SCAMWIN_${prefix}_CLIENT_SECRET`); }
      if (provider === 'gmail' || provider === 'outlook') {
        const key = `SCAMWIN_${prefix}_REDIRECT_URI`;
        if (env[key]) add(key, origin && env[key] === `${origin}/api/scamwin/connections/${provider}/callback`, 'expected_fixed_callback');
      }
      if (provider === 'gmail' && !enabled('SCAMWIN_GMAIL_PUBLIC_ELIGIBLE')) {
        add('SCAMWIN_GMAIL_TEST_USER_PILOT', enabled('SCAMWIN_GMAIL_TEST_USER_PILOT'), 'gmail_eligibility_or_private_pilot_required');
        let valid = false;
        try { const subjects = JSON.parse(env.SCAMWIN_GMAIL_PILOT_SUBJECTS ?? ''); valid = Array.isArray(subjects) && subjects.length > 0 && subjects.length <= 100 && subjects.every(value => typeof value === 'string' && value.length > 0 && value.length <= 300); } catch { /* Owner IDs stay private. */ }
        add('SCAMWIN_GMAIL_PILOT_SUBJECTS', valid, 'bounded_nonempty_pilot_allowlist_required');
      }
      if (provider === 'telegram') {
        add('SCAMWIN_TELEGRAM_BOT_TOKEN', /^\d{5,20}:[A-Za-z0-9_-]{20,200}$/.test(env.SCAMWIN_TELEGRAM_BOT_TOKEN ?? ''), 'invalid_bot_configuration');
        add('SCAMWIN_TELEGRAM_BOT_USERNAME', /^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(env.SCAMWIN_TELEGRAM_BOT_USERNAME ?? ''), 'invalid_bot_configuration');
        add('SCAMWIN_TELEGRAM_WEBHOOK_SECRET', /^[A-Za-z0-9_-]{32,256}$/.test(env.SCAMWIN_TELEGRAM_WEBHOOK_SECRET ?? ''), 'invalid_webhook_secret');
      }
      if (provider === 'slack') { requireValue('SCAMWIN_SLACK_APP_ID', 80); requireValue('SCAMWIN_SLACK_SIGNING_SECRET'); }
      if (provider === 'discord') {
        add('SCAMWIN_DISCORD_CLIENT_ID', /^[1-9][0-9]{16,19}$/.test(env.SCAMWIN_DISCORD_CLIENT_ID ?? ''), 'invalid_discord_application_id');
        add('SCAMWIN_DISCORD_PUBLIC_KEY', hexKey(env.SCAMWIN_DISCORD_PUBLIC_KEY), 'expected_ed25519_public_key');
      }
      if (provider === 'drive') {
        add('SCAMWIN_DRIVE_CLIENT_ID', !env.SCAMWIN_GOOGLE_CLIENT_ID || env.SCAMWIN_DRIVE_CLIENT_ID !== env.SCAMWIN_GOOGLE_CLIENT_ID, 'dedicated_drive_client_required');
        add('SCAMWIN_DRIVE_INSTALLATION_ACCEPTED', enabled('SCAMWIN_DRIVE_INSTALLATION_ACCEPTED'), 'drive_installation_acceptance_required');
      }
    }
    const configured = requested && checks.slice(start).every(check => check.ok);
    const automaticPilot = provider === 'slack' ? enabled('SCAMWIN_SLACK_COVERAGE_PILOT_ACCEPTED') : provider === 'teams' ? enabled('SCAMWIN_TEAMS_AUTOMATION_PILOT_ACCEPTED') : provider === 'drive' ? enabled('SCAMWIN_DRIVE_AUTOMATION_PILOT_ACCEPTED') : true;
    const available = global && shared && configured;
    providerResults[provider] = { enabled: requested, configured, available, automaticAvailable: available && provider !== 'discord' && enabled('SCAMWIN_CONNECTOR_AUTOMATION_ENABLED') && enabled('SCAMWIN_CONNECTOR_RUNTIME_ENABLED') && automaticPilot,
      capability: provider === 'discord' ? 'manual_only' : provider === 'drive' ? 'selected_files_only' : provider === 'extension' ? 'foreground_pages_only' : 'authorized_scope_only',
      reasons: !requested ? ['provider_gate_disabled'] : !global ? ['global_gate_disabled'] : !shared ? ['shared_configuration_invalid'] : !configured ? ['provider_configuration_unavailable'] : ['configuration_only_live_acceptance_required'],
      ...(provider === 'gmail' ? { publicEligible: enabled('SCAMWIN_GMAIL_PUBLIC_ELIGIBLE') } : {}),
    };
  }
  if (push) {
    add('SCAMWIN_WEB_PUSH_PUBLIC_KEY', /^[A-Za-z0-9_-]{87}$/.test(env.SCAMWIN_WEB_PUSH_PUBLIC_KEY ?? ''), 'invalid_vapid_public_key');
    add('SCAMWIN_WEB_PUSH_PRIVATE_KEY', /^[A-Za-z0-9_-]{43}$/.test(env.SCAMWIN_WEB_PUSH_PRIVATE_KEY ?? ''), 'invalid_vapid_private_key');
    add('SCAMWIN_WEB_PUSH_SUBJECT', /^mailto:[^\s]+@[^\s]+$/.test(env.SCAMWIN_WEB_PUSH_SUBJECT ?? '') && !/(?:example\.(?:com|org|net)|replace-with)/i.test(env.SCAMWIN_WEB_PUSH_SUBJECT ?? ''), 'real_operator_mailto_contact_required');
  }
  const ok = checks.every(check => check.ok);
  return { ok, status: !ok ? 'invalid' : global || push ? 'configuration_valid' : 'disabled', checks, providers: providerResults, liveAcceptance: 'not_checked',
    operatorChecks: ['isolated_database_schema', 'provider_approvals_and_grants', 'separate_drive_project', 'real_browser_permissions_and_delivery', 'measured_runtime_and_free_tier_headroom'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const result = inspectConnectorConfiguration(process.env); console.log(JSON.stringify(result, null, 2)); if (!result.ok) process.exitCode = 1; }
  catch { console.error('Connector configuration inspection failed. No supplied values printed.'); process.exitCode = 1; }
}
