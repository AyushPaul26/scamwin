"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircleIcon } from "lucide-react";
import { ChatAvatar } from "@/components/chat-avatar";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

export type SidebarChat = {
  id: string;
  name: string;
  avatar: string | null;
  preview: string | null;
  lastMessageAt: string;
  relativeTime: string;
};

export function SidebarChats({ chats }: { chats: SidebarChat[] }) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();

  return (
    <SidebarGroup aria-label="Your chats" className="p-3">
      <SidebarGroupContent>
        <SidebarGroupLabel className="mb-1 group-data-[collapsible=icon]:hidden">Chats</SidebarGroupLabel>
        <SidebarMenu className="gap-1">
          {chats.map((chat) => (
            <SidebarMenuItem key={chat.id} data-chat-id={chat.id}>
              <SidebarMenuButton render={<Link href={`/chats/${encodeURIComponent(chat.id)}`} prefetch={false} onNavigate={() => setOpenMobile(false)} />} tooltip={chat.name} aria-label={`Open chat ${chat.name}`} isActive={pathname === `/chats/${encodeURIComponent(chat.id)}`} aria-current={pathname === `/chats/${encodeURIComponent(chat.id)}` ? "page" : undefined} size="lg" className="h-14 gap-3 rounded-xl group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center">
                {chat.avatar ? <ChatAvatar seed={chat.avatar} alt={`${chat.name} avatar`} className="size-10 shrink-0" /> : <span className="flex size-10 shrink-0 items-center justify-center"><MessageCircleIcon aria-hidden="true" className="size-5 text-muted-foreground" /></span>}
                <span className="flex min-w-0 flex-1 flex-col gap-1 group-data-[collapsible=icon]:hidden">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate" title={chat.name}>{chat.name}</span>
                    <time dateTime={chat.lastMessageAt} title={chat.lastMessageAt} className="shrink-0 text-xs text-muted-foreground">{chat.relativeTime}</time>
                  </span>
                  <span className="truncate text-xs text-muted-foreground" title={chat.preview ?? undefined}>{chat.preview || "No messages yet"}</span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
        {chats.length === 0 && <p role="status" className="px-2 py-4 text-sm text-muted-foreground group-data-[collapsible=icon]:sr-only">No chats yet. Create a bot to get started.</p>}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
