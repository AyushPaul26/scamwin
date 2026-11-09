import assert from 'node:assert/strict';
import test from 'node:test';
import { trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { privateOperation } from '../lib/private-operation';
test('raw SDK errors are not exported through the existing global tracer',async()=>{
 const exporter=new InMemorySpanExporter();const provider=new NodeTracerProvider({spanProcessors:[new SimpleSpanProcessor(exporter)]});provider.register();
 try {await privateOperation(async()=>{await Promise.resolve();const span=trace.getTracer('daytona-typescript-sdk').startSpan('sdk');span.recordException(new Error('SECRET_MARKER_FILE_PATH'));span.end();});await provider.forceFlush();assert.equal(exporter.getFinishedSpans().length,0);}finally{await provider.shutdown();trace.disable();}
});
