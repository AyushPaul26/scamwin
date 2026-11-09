import { context } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
/** SDK exception spans can contain commands, paths, responses or credentials. */
export function privateOperation<T>(operation: () => T): T {
  return context.with(suppressTracing(context.active()), operation);
}
