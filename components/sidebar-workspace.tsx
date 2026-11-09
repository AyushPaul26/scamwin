"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { MessageCircleIcon, SearchIcon, ChartNoAxesCombinedIcon } from "lucide-react";
import { ChatAvatar } from "@/components/chat-avatar";
import { useCreatureMotion } from "@/components/creatures/creature-motion";
import { SidebarChats, type SidebarChat } from "@/components/sidebar-chats";
import { SidebarNewMenu } from "@/components/sidebar-new-menu";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";

const subscribeToPlatform = () => () => {};
const getShortcutModifier = () => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent) ? "⌘" : "Ctrl";
const getServerShortcutModifier = () => "Ctrl";

export function SidebarWorkspace({ chats, error, account }: { chats: SidebarChat[]; error?: string; account: ReactNode }) {
  const [open, setOpen] = useState(false);
  const shortcutModifier = useSyncExternalStore(subscribeToPlatform, getShortcutModifier, getServerShortcutModifier);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { isMobile, setOpenMobile } = useSidebar();
  const { setDialogOpen } = useCreatureMotion();
  const dialogId = useId();

  useEffect(() => {
    setDialogOpen(dialogId, open);
    return () => setDialogOpen(dialogId, false);
  }, [dialogId, open, setDialogOpen]);

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey) || event.altKey || event.repeat || event.isComposing) return;
      const modal = (event.target as HTMLElement)?.closest?.('[role="dialog"]');
      if (modal && !modal.querySelector('[data-slot="command"]') && modal.getAttribute("data-sidebar") !== "sidebar") return;
      event.preventDefault();
      if (!open && isMobile) setOpenMobile(false);
      setOpen(!open);
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [open, isMobile, setOpenMobile]);

  return (
    <>
      <Sidebar collapsible="icon" className="dark dashboard-theme workspace-sidebar">
        <SidebarHeader className="gap-4 p-3 pb-1">
          <div className="flex h-10 items-center gap-2 pr-10 md:pr-0">
            <SidebarTrigger className="hidden size-10 shrink-0 rounded-xl md:inline-flex [&>svg]:size-5" />
            <Link href="/dashboard" className="flex items-center gap-2 rounded-lg px-2 py-1 text-xl font-semibold tracking-tight focus-visible:outline-2 focus-visible:outline-ring group-data-[collapsible=icon]:hidden" onNavigate={() => setOpenMobile(false)}>OpenMods</Link>
          </div>
          <SidebarMenu className="gap-1">
            <SidebarMenuItem><SidebarNewMenu /></SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton ref={triggerRef} type="button" tooltip={`Search chats · ${shortcutModifier}+K`} aria-label="Search chats" aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts="Meta+k Control+k"
                className="h-10 min-w-0 gap-3 rounded-lg border border-input bg-input/30 px-2.5 py-1 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:rounded-xl group-data-[collapsible=icon]:border-transparent group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:text-sidebar-foreground group-data-[collapsible=icon]:hover:bg-sidebar-accent [&>svg]:size-5"
                onClick={() => { if (isMobile) setOpenMobile(false); setOpen(true); }}>
                <SearchIcon /><span className="flex-1 text-left whitespace-nowrap group-data-[collapsible=icon]:hidden">Search chats</span>
                <KbdGroup aria-hidden="true" className="group-data-[collapsible=icon]:hidden max-md:hidden"><Kbd>{shortcutModifier}</Kbd><Kbd>K</Kbd></KbdGroup>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem><SidebarMenuButton render={<Link href="/usage" onNavigate={() => setOpenMobile(false)} />} tooltip="Usage" className="h-10 gap-3 group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center [&>svg]:size-5"><ChartNoAxesCombinedIcon /><span className="group-data-[collapsible=icon]:hidden">Usage</span></SidebarMenuButton></SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          {error ? <p role="status" className="p-4 text-sm text-muted-foreground">{error}</p> : <SidebarChats chats={chats} />}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3">{account}</SidebarFooter>
        <SidebarRail aria-label="Toggle sidebar rail" tabIndex={0} className="max-md:hidden focus-visible:after:bg-ring" />
      </Sidebar>
      <CommandDialog open={open} onOpenChange={setOpen} title="Search chats" description="Find a chat by its name or latest message. Select a chat to open it."
        className="dark dashboard-theme top-1/2 max-h-[calc(100dvh-2rem)] -translate-y-1/2 sm:max-w-md"
        contentProps={{ initialFocus: inputRef, finalFocus: () => {
          if (triggerRef.current?.getClientRects().length) return triggerRef.current;
          return document.querySelector<HTMLButtonElement>('[data-sidebar="trigger"]');
        } }}>
        <Command filter={(_value, search, keywords) => (keywords ?? []).join(" ").toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0}>
          <CommandInput ref={inputRef} placeholder="Search chats…" aria-label="Search chats" />
          <CommandList className="max-h-[min(18rem,55dvh)]">
            <CommandEmpty>{error ?? (chats.length ? "No chats match your search." : "No chats yet. Create a bot to get started.")}</CommandEmpty>
            <CommandGroup heading="Chats">
              {chats.map((chat) => (
                <CommandItem key={chat.id} value={chat.id} keywords={[chat.name, chat.preview ?? ""]} onSelect={() => {
                  setOpen(false);
                  setOpenMobile(false);
                  router.push(`/chats/${encodeURIComponent(chat.id)}`);
                }}>
                  {chat.avatar ? <ChatAvatar seed={chat.avatar} alt={`${chat.name} avatar`} className="size-10 shrink-0" /> : <MessageCircleIcon aria-hidden="true" />}
                  <span className="flex min-w-0 flex-1 flex-col gap-1"><span className="truncate">{chat.name}</span><span className="truncate text-xs text-muted-foreground">{chat.preview || "No messages yet"}</span></span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
