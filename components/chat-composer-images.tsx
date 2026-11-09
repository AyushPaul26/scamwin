"use client";

import Image from "next/image";
import type { ComponentProps } from "react";
import { ArrowUpIcon, ImageIcon, XIcon } from "lucide-react";
import { usePromptInputAttachments, PromptInputSubmit } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

export function ChatImageMenuItem({ disabled }: { disabled: boolean }) {
  const attachments = usePromptInputAttachments();
  return <DropdownMenuItem disabled={disabled} onClick={attachments.openFileDialog}><ImageIcon />Add photos</DropdownMenuItem>;
}

export function ChatImagePreviews({ disabled, onRemove }: { disabled: boolean; onRemove: () => void }) {
  const attachments = usePromptInputAttachments();
  if (!attachments.files.length) return null;
  return <div role="group" className="order-first flex w-full flex-wrap gap-3 px-3 pt-3 pb-1" aria-label="Attached images">
    {attachments.files.map(file => <div key={file.id} className="relative size-20 shrink-0">
      <Image unoptimized width={80} height={80} src={file.url} alt={file.filename || "Image preview"} className="size-20 rounded-xl object-cover" />
      <Button type="button" variant="secondary" size="icon" disabled={disabled} onClick={() => { attachments.remove(file.id); onRemove(); }} aria-label={`Remove ${file.filename || "image"}`} className="absolute -top-2 -right-2 size-6 rounded-full border shadow-sm"><XIcon className="size-3.5" /></Button>
    </div>)}
  </div>;
}

export function ChatImageSubmit({ hasText, busy, children, disabled, ...props }: ComponentProps<typeof PromptInputSubmit> & { hasText: boolean; busy: boolean }) {
  const attachments = usePromptInputAttachments();
  return <PromptInputSubmit {...props} disabled={disabled || (!busy && !hasText && !attachments.files.length)}>
    {!busy && !hasText && attachments.files.length ? <span className="grid size-8 place-items-center rounded-full bg-white"><ArrowUpIcon aria-hidden="true" className="size-[18px]" strokeWidth={1.75} /></span> : children}
  </PromptInputSubmit>;
}
