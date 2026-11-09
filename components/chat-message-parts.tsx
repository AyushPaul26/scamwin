'use client';
import { Fragment } from 'react';
import Image from 'next/image';
import type { UIMessage } from 'ai';
import type { ChatMetadata, BotIdentity } from '@/lib/sandbox-tools';
import { ChatAvatar } from '@/components/chat-avatar';
import { MessageResponse } from '@/components/ai-elements/message';
import { isChatImage } from '@/lib/chat-images';
export function ChatMessageParts({ message, fallback, active = false }: { message: UIMessage; fallback: string; active?: boolean }) {
  const metadata = message.metadata as ChatMetadata | undefined;
  const author = metadata?.author;
  return <>
    {message.role === 'user' && metadata?.recipient && <p className="mb-1 text-xs text-muted-foreground">To {metadata.recipient.name}</p>}
    {message.role === 'assistant' && <Identity author={author} fallback={fallback} />}
    {message.parts.map((part, index) => {
      if (part.type === 'file' && isChatImage(part)) return <Image key={index} unoptimized width={640} height={480} src={part.url} alt={part.filename || 'Attached image'} className="my-2 max-h-80 w-auto max-w-full rounded-2xl object-contain" />;
      if (part.type === 'text') return message.role === 'user' ? <p key={index} className="whitespace-pre-wrap wrap-anywhere leading-7">{part.text}</p> : <MessageResponse key={index}>{part.text}</MessageResponse>;
      if (!part.type.startsWith('tool-')) return null;
      const tool = part as unknown as { type: string; state: string; output?: unknown; errorText?: string };
      const name = tool.type.slice(5);
      const done = tool.state === 'output-available';
      const failed = tool.state === 'output-error' || tool.state === 'output-denied';
      if (name === 'handoff' && done && tool.output && typeof tool.output === 'object') {
        const author = tool.output as BotIdentity;
        return <Fragment key={index}><p className="my-3 text-xs text-muted-foreground">Handed off to {author.name}</p><Identity author={author} fallback={fallback} /></Fragment>;
      }
      if (name === 'viewScreen' && done) return <p key={index} className="text-xs text-muted-foreground">Screen inspected</p>;
      if (name === 'showScreen' && done) {
        const output = tool.output as { base64?: string; mediaType?: string };
        return output?.base64 ? <figure key={index} className="my-3"><Image unoptimized width={1280} height={720} src={`data:image/jpeg;base64,${output.base64}`} alt={`${author?.name ?? fallback}'s computer screenshot`} className="max-h-96 max-w-full rounded-lg border object-contain" /></figure> : null;
      }
      return <details key={index} className="my-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs" open={failed}>
        <summary className="cursor-pointer font-medium">{name} · {failed ? 'Failed' : done ? 'Completed' : active ? 'Working…' : 'Interrupted'}</summary>
        {failed ? <p role="alert" className="mt-2">The tool could not complete. The agent can retry or try another approach.</p> : done ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(tool.output, null, 2)}</pre> : <p role="status" className="mt-2">{active ? 'Waiting for the computer…' : 'Stopped before the tool returned a result.'}</p>}
      </details>;
    })}
  </>;
}
function Identity({ author, fallback }: { author?: BotIdentity; fallback: string }) {
  return <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">{author?.avatar && <ChatAvatar seed={author.avatar} alt="" className="size-6" />}{author?.name ?? fallback}</p>;
}
