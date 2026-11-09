"use client";

import { useRef, useState, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useTriggerChatTransport } from "@trigger.dev/sdk/chat/react";
import type { ChatSessionPersistedState } from "@trigger.dev/sdk/chat";
import type { openmodsChat } from "@/src/trigger/chat";
import { getChatAccessToken, connectChatSession } from "@/lib/chat-connection";
import { motion, useReducedMotion } from "motion/react";
import { ArrowUpIcon, CheckIcon, Code2Icon, ListChecksIcon, MicIcon, PlusIcon, RotateCcwIcon, SquareIcon, ChevronDownIcon, TerminalIcon } from "lucide-react";
import { CHAT_TEXT_LIMIT, replyStyles, type ReplyStyle } from "@/lib/chat-input";
import { cn } from "@/lib/utils";
import { useChatDictation } from "@/hooks/use-chat-dictation";
import { useChatHistoryRecovery } from "@/hooks/use-chat-history-recovery";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { ChatMessageParts } from "@/components/chat-message-parts";
import type { GroupMember } from "@/lib/group-form-schema";
import type { ChatMetadata } from "@/lib/sandbox-tools";
import { resolveRecipientId } from "@/lib/chat-recipient";
import { useRouter } from "next/navigation";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { PromptInput, PromptInputTextarea } from "@/components/ai-elements/prompt-input";
import { ChatImageMenuItem, ChatImagePreviews, ChatImageSubmit } from "@/components/chat-composer-images";
import { CHAT_IMAGE_ACCEPT, CHAT_IMAGE_COUNT, CHAT_IMAGE_ERROR, CHAT_IMAGE_UPLOAD_BYTES, prepareChatImages } from "@/lib/chat-images";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InputGroupAddon } from "@/components/ui/input-group";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const starters = [
  { label: "Review some code", text: "Review this code for bugs and suggest improvements:\n\n", icon: Code2Icon },
  { label: "Plan a task", text: "Help me break this task into a clear implementation plan:\n\n", icon: ListChecksIcon },
  { label: "Explain an error", text: "Help me understand and fix this error:\n\n", icon: TerminalIcon },
];

export function ChatConversation({ chatId, name, initialMessages, initialSession, members, kind }: {
  members: GroupMember[]; kind: "direct" | "group";
  chatId: string; name: string; initialMessages: UIMessage[]; initialSession?: ChatSessionPersistedState;
}) {
  const [selectedRecipientId, setRecipientId] = useState(members[0]?.id ?? "");
  const recipientId = resolveRecipientId(members, selectedRecipientId);
  const router = useRouter();
  const recipientRef = useRef(recipientId);
  useEffect(() => { recipientRef.current = recipientId; }, [recipientId]);
  const [draft, setDraft] = useState("");
  const dictation = useChatDictation(setDraft);
  const [style, setStyle] = useState<ReplyStyle>("balanced");
  const [inputError, setInputError] = useState<string>();
  const [preparingImages, setPreparingImages] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sending = useRef(false);
  const transport = useTriggerChatTransport<typeof openmodsChat>({
    task: "openmods-chat",
    accessToken: ({ chatId }) => getChatAccessToken(chatId),
    startSession: ({ chatId }) => connectChatSession(chatId, recipientRef.current || undefined),
    clientData: { style, recipientId: recipientId || undefined },
    sessions: initialSession ? { [chatId]: initialSession } : undefined,
  });
  const { messages, sendMessage, status, stop, error, regenerate, clearError, setMessages } = useChat({
    id: chatId, transport, messages: initialMessages, resume: !!initialSession,
  });
  useChatHistoryRecovery({ chatId, initialMessages, messages, status, setMessages });
  const busy = status === "submitted" || status === "streaming";
  const previousStatus = useRef(status);
  useEffect(() => { if (previousStatus.current !== "ready" && status === "ready") router.refresh(); previousStatus.current = status; }, [status, router]);
  const hasDraft = draft.trim().length > 0;
  const hasMessages = messages.length > 0;
  const reduceMotion = useReducedMotion();

  function insertPrompt(text: string) {
    dictation.cancel();
    setDraft(text);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return (
    <section
      className={cn("flex min-h-0 flex-1 flex-col", hasMessages ? "overflow-hidden" : "overflow-y-auto")}
      aria-label={`Conversation with ${name}`}
      data-chat-state={hasMessages ? "active" : "welcome"}
    >
      {hasMessages && <Conversation className="min-h-0" aria-label="Chat messages" initial={reduceMotion ? "instant" : "smooth"} resize={reduceMotion ? "instant" : "smooth"}>
        <ConversationContent className="mx-auto min-h-full w-full max-w-3xl gap-6 px-5 py-8 sm:px-8">
          {messages.map((message) => (
            <Message key={message.id} from={message.role} className="max-w-full">
              <span className="sr-only">{message.role === "user" ? "You" : name}</span>
              <MessageContent className="group-[.is-user]:max-w-[90%] group-[.is-user]:rounded-3xl group-[.is-user]:px-5 group-[.is-user]:py-3">
                <ChatMessageParts message={message} fallback={name} active={busy && message.id === messages.at(-1)?.id} />
              </MessageContent>
            </Message>
          ))}
          {status === "submitted" && <p role="status" className="text-sm text-muted-foreground">{name} is thinking<span className="motion-safe:animate-pulse">…</span></p>}
        </ConversationContent>
        <ConversationScrollButton aria-label="Jump to latest message" />
      </Conversation>}
      <div
        className={cn("mx-auto w-full max-w-[816px] shrink-0 px-4 sm:px-6", hasMessages ? "pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]" : "my-auto py-8")}
        data-chat-composer-container
      >
        {!hasMessages && <h2 className="mb-7 text-center text-2xl font-medium tracking-tight sm:mb-8 sm:text-3xl">What are we working on?</h2>}
        {/* Keep the form mounted while its position changes, including during retries. */}
        {kind === "group" && <div className="mb-3 flex items-center gap-2 text-sm"><label htmlFor="chat-recipient">Send to</label><select id="chat-recipient" value={recipientId} disabled={busy || !members.length} onChange={event => setRecipientId(event.target.value)} className="max-w-56 rounded-lg border bg-background px-3 py-2">{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>{!members.length && <span role="status">Add teammates to send messages.</span>}</div>}
        <motion.div
          layout={reduceMotion ? false : "position"}
          layoutDependency={hasMessages}
          transition={{ layout: { duration: 0.22, ease: [0.22, 1, 0.36, 1] } }}
          data-chat-composer-motion
        >
          {(error || inputError || dictation.error) && <Alert variant="destructive" className="mb-3"><AlertDescription className="flex flex-wrap items-center justify-between gap-2"><span>{dictation.error ?? inputError ?? "Couldn’t get a reply. Your message is still here. Try again in a moment."}</span>{error && <Button variant="ghost" size="sm" disabled={busy} onClick={() => { if (sending.current) return; sending.current = true; dictation.cancel(); clearError(); void regenerate({ body: { style, recipientId: (messages.findLast(m => m.role === "user")?.metadata as ChatMetadata | undefined)?.recipientId ?? recipientId } }).finally(() => { sending.current = false; }); }}><RotateCcwIcon data-icon="inline-start" />Retry</Button>}</AlertDescription></Alert>}
          <PromptInput
            aria-label="Message composer"
            accept={CHAT_IMAGE_ACCEPT}
            multiple
            maxFiles={CHAT_IMAGE_COUNT}
            maxFileSize={CHAT_IMAGE_UPLOAD_BYTES}
            disabled={preparingImages}
            onError={() => setInputError(CHAT_IMAGE_ERROR)}
            className="[&>[data-slot=input-group]]:flex-wrap [&>[data-slot=input-group]]:min-h-14 [&>[data-slot=input-group]]:items-end [&>[data-slot=input-group]]:rounded-[28px] [&>[data-slot=input-group]]:border-white/[0.06] [&>[data-slot=input-group]]:bg-[#222222] [&>[data-slot=input-group]]:p-[5px] [&>[data-slot=input-group]]:shadow-none [&>[data-slot=input-group]]:focus-within:border-white/20 [&>[data-slot=input-group]]:focus-within:ring-1 [&>[data-slot=input-group]]:focus-within:ring-white/10 [&>[data-slot=input-group]]:has-disabled:opacity-100 [&>[data-slot=input-group]]:has-disabled:bg-[#222222]"
            onSubmit={async ({ text, files }) => {
              if ((!text.trim() && !files.length) || busy || sending.current || !members.length || !members.some(m => m.id === recipientId)) throw new Error("Message cannot be sent yet.");
              sending.current = true;
              dictation.cancel();
              setInputError(undefined);
              setPreparingImages(true);
              try {
                const images = await prepareChatImages(files);
                clearError();
                setDraft("");
                void sendMessage({ text: text.trim(), files: images, metadata: { recipientId } }).finally(() => { sending.current = false; });
                requestAnimationFrame(() => inputRef.current?.focus());
              } catch (error) {
                sending.current = false;
                setInputError(error instanceof Error ? error.message : "Couldn’t prepare the images. Please try again.");
                throw error;
              } finally {
                setPreparingImages(false);
              }
            }}
          >
            <ChatImagePreviews disabled={preparingImages} onRemove={() => setInputError(undefined)} />
            <InputGroupAddon align="inline-start" className="self-end p-0 has-[>button]:ml-0">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon" disabled={preparingImages} className="size-11 rounded-full hover:bg-white/[0.06] dark:hover:bg-white/[0.06]" aria-label="Starter prompts" />}><PlusIcon className="size-[22px]" strokeWidth={1.75} /></DropdownMenuTrigger>
                <DropdownMenuContent side="top" className="dark dashboard-theme w-52" finalFocus={inputRef}>
                  <DropdownMenuGroup><ChatImageMenuItem disabled={busy || preparingImages} />{starters.map(({ label, text, icon: Icon }) => <DropdownMenuItem key={label} onClick={() => insertPrompt(text)}><Icon />{label}</DropdownMenuItem>)}</DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </InputGroupAddon>
            <PromptInputTextarea ref={inputRef} rows={1} value={draft} disabled={preparingImages} onChange={(event) => setDraft(event.target.value)} maxLength={CHAT_TEXT_LIMIT} placeholder={`Message ${name}…`} aria-label={`Message ${name}`} className="min-h-11 min-w-0 max-h-40 resize-none overflow-y-auto border-0 px-2 py-2.5 text-base leading-6 md:text-base" />
            <InputGroupAddon align="inline-end" className="gap-1 self-end p-0 has-[>button]:mr-0">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button type="button" variant="ghost" disabled={busy || preparingImages} className="hidden h-11 rounded-full px-3 font-normal hover:bg-white/[0.06] sm:inline-flex dark:hover:bg-white/[0.06]" aria-label="Reply style" />}>
                  {replyStyles[style].label}<ChevronDownIcon data-icon="inline-end" />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" className="dark dashboard-theme w-40">
                  <DropdownMenuGroup>{Object.entries(replyStyles).map(([value, option]) => <DropdownMenuItem key={value} onClick={() => setStyle(value as ReplyStyle)}>{option.label}{value === style && <CheckIcon className="ml-auto" />}</DropdownMenuItem>)}</DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy || preparingImages || dictation.phase === "stopping"}
                aria-label={dictation.phase === "idle" ? "Dictate message" : "Stop dictation"}
                aria-pressed={dictation.phase !== "idle"}
                title={dictation.phase === "idle" ? "Dictate message" : "Stop dictation"}
                onClick={dictation.toggle}
                className={cn("size-11 rounded-full hover:bg-white/[0.06] dark:hover:bg-white/[0.06]", dictation.phase !== "idle" && "bg-white/10 text-foreground")}
              >
                <MicIcon aria-hidden="true" className="size-[18px]" strokeWidth={1.75} />
              </Button>
              <ChatImageSubmit
                busy={busy}
                hasText={hasDraft}
                status={status}
                onStop={() => { void stop(); void transport.stopGeneration(chatId).then((stopped) => { if (!stopped) setInputError("Couldn’t stop the reply. Please try again."); }); }}
                disabled={preparingImages || (!busy && (!members.length || !members.some(m => m.id === recipientId)))}
                aria-label={busy ? "Stop response" : "Send message"}
                title={busy ? "Stop response" : hasDraft ? "Send message" : "Type a message to send"}
                variant="ghost"
                className="size-11 rounded-full bg-transparent p-0 text-[#161616] hover:bg-transparent hover:text-[#161616] disabled:opacity-100 dark:hover:bg-transparent [&:hover>span]:bg-white/90"
              >
                <span className="grid size-8 place-items-center rounded-full bg-white transition-colors">
                  {busy ? <SquareIcon aria-hidden="true" className="size-3.5" /> : hasDraft ? <ArrowUpIcon aria-hidden="true" className="size-[18px]" strokeWidth={1.75} /> : (
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="size-4">
                      <path d="M3 9v6M9 3v18M15 6v12M21 10v4" />
                    </svg>
                  )}
                </span>
              </ChatImageSubmit>
            </InputGroupAddon>
          </PromptInput>
          <p className="mt-2 text-center text-[11px] text-muted-foreground" role={dictation.phase !== "idle" ? "status" : undefined}>
            {preparingImages ? "Preparing images…" : dictation.phase === "starting" ? "Waiting for microphone permission…" : dictation.phase === "listening" ? "Listening… Tap the microphone to finish." : dictation.phase === "stopping" ? "Finishing dictation…" : "AI can make mistakes. Messages are saved to this chat."}
          </p>
        </motion.div>
        {!hasMessages && <div className="mt-6 flex flex-wrap justify-center gap-2" data-chat-starters aria-label="Suggested prompts">
          {starters.map(({ label, text, icon: Icon }) => <Button key={label} disabled={preparingImages} variant="outline" className="h-9 rounded-full border-white/[0.08] px-3 font-normal text-muted-foreground hover:text-foreground dark:bg-transparent" onClick={() => insertPrompt(text)}><Icon data-icon="inline-start" />{label}</Button>)}
        </div>}
      </div>
    </section>
  );
}
