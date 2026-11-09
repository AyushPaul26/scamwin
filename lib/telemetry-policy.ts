// Allowlist diagnostics rather than trying to recognize every possible secret.
export function scrubEvent<T extends { [key: string]: unknown }>(event: T): T {
  const safe: Record<string, unknown> = {};
  for (const key of ['event_id', 'timestamp', 'platform', 'level', 'release', 'environment', 'sdk', 'type']) if (event[key] !== undefined) safe[key] = event[key];
  if (event.exception && typeof event.exception === 'object') {
    const values = (event.exception as { values?: Array<{ type?: string; stacktrace?: { frames?: Array<Record<string, unknown>> } }> }).values;
    safe.exception = { values: values?.map(v => ({ type: v.type, value: 'OpenMods operation failed', stacktrace: { frames: v.stacktrace?.frames?.map(f => ({ filename: typeof f.filename === 'string' ? f.filename.split('?')[0] : undefined, function: f.function, lineno: f.lineno, colno: f.colno, in_app: f.in_app })) } })) };
  }
  if (event.message) safe.message = 'OpenMods operational event';
  return safe as T;
}
