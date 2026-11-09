import type { NodeOptions } from '@sentry/node';
import { scrubEvent } from './telemetry-policy';
export const privacyOptions = {
  dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false }, mcp: { inputs: false, outputs: false }, databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0 },
  beforeSendLog: () => null,
  beforeBreadcrumb: () => null,
  beforeSend: event => scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
  beforeSendSpan: span => ({ trace_id: span.trace_id, parent_span_id: span.parent_span_id, span_id: span.span_id, name: 'OpenMods operation', start_timestamp: span.start_timestamp, end_timestamp: span.end_timestamp, status: span.status, is_segment: span.is_segment, attributes: {} }),
} satisfies Partial<NodeOptions>;
