import { Suspense } from "react";
import { connection } from "next/server";
import { formatDistanceStrict } from "date-fns";
import { getUserChats } from "@/queries/bots";
import { SidebarWorkspace } from "@/components/sidebar-workspace";
import { auth0 } from "@/lib/auth0";
import { SidebarUserButton } from "@/components/sidebar-user-button";
import { Skeleton } from "@/components/ui/skeleton";

async function SidebarData() {
  // Keep session lookup and the relative-time clock outside prerendering,
  // including when the query below falls back to its error state.
  await connection();
  let chats: Awaited<ReturnType<typeof getUserChats>> = [];
  let error;
  try {
    chats = await getUserChats();
  } catch {
    error = "Your chats couldn’t be loaded. Please refresh to try again.";
  }
  const now = new Date();
  return <SidebarWorkspace error={error} account={<Suspense fallback={<Skeleton className="h-12 w-full" aria-label="Loading account" />}><SidebarAccount /></Suspense>} chats={chats.map((chat) => ({
    ...chat,
    lastMessageAt: chat.lastMessageAt.toISOString(),
    relativeTime: now.getTime() - chat.lastMessageAt.getTime() < 60000 ? "Just now" : formatDistanceStrict(chat.lastMessageAt, now),
  }))} />;
}

async function SidebarAccount() {
  const session = await auth0.getSession();
  if (!session?.user.sub) return null;
  const user = session.user;
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  const email = text(user.email);
  const picture = text(user.picture);

  return <SidebarUserButton profile={{
    name: text(user.name) ?? text(user.nickname) ?? email ?? "Your account",
    email,
    picture: picture && /^https?:\/\//i.test(picture) ? picture : undefined,
    emailVerified: typeof user.email_verified === "boolean" ? user.email_verified : undefined,
  }} />;
}

export function AppSidebar({ defaultOpen = true }: { defaultOpen?: boolean }) {
  return (
    <Suspense fallback={<div className="hidden h-svh shrink-0 flex-col gap-2 bg-sidebar p-2 md:flex" style={{ width: defaultOpen ? "var(--sidebar-width)" : "var(--sidebar-width-icon)" }} aria-label="Loading chats"><Skeleton className="h-8 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}>
      <SidebarData />
    </Suspense>
  );
}
