import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { auth0 } from "@/lib/auth0";
import { getDb } from "@/lib/db";
import { bots } from "@/lib/db/schema";
import { ChatAvatar } from "@/components/chat-avatar";
import { GroupDialog } from "@/components/group-dialog";
import { CreateBotDialog } from "@/components/dashboard/create-bot-dialog";
import { DashboardWelcome } from "@/components/dashboard/dashboard-welcome";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

export const metadata: Metadata = { title: "Dashboard" };

async function DashboardContent() {
  const session = await auth0.getSession();
  if (!session?.user.sub) redirect("/sign-in");

  let userBots;
  try {
    userBots = await getDb().select({ id: bots.id, name: bots.name, job: bots.job, avatar: bots.avatar })
      .from(bots).where(eq(bots.userId, session.user.sub)).orderBy(desc(bots.createdAt), desc(bots.id));
  } catch {
    return (
      <div className="flex w-full max-w-sm flex-col items-center gap-4">
        <Alert>
          <AlertTitle>Your bots couldn’t be loaded</AlertTitle>
          <AlertDescription>Please try again in a moment.</AlertDescription>
        </Alert>
        <Button variant="secondary" render={<a href="/dashboard" />} nativeButton={false}>Try again</Button>
      </div>
    );
  }

  if (userBots.length === 0) {
    const welcomeAvatarSeed = nanoid();

    return <DashboardWelcome initialSeed={welcomeAvatarSeed} />;
  }

  return (
    <section className="mx-auto flex w-full max-w-4xl flex-col gap-8 py-12 sm:py-20" aria-labelledby="bots-title">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 id="bots-title" className="text-2xl font-medium tracking-tight">Your bots</h1>
          <p className="text-sm text-muted-foreground">A little personality. A purpose of their own.</p>
        </div>
        <div className="flex gap-2"><GroupDialog /><CreateBotDialog /></div>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {userBots.map((bot) => (
          <li key={bot.id} className="min-w-0">
            <Card className="h-full">
              <CardHeader className="gap-3">
                <ChatAvatar seed={bot.avatar} alt={`${bot.name} avatar`} className="size-10" />
                <CardTitle><h2 className="wrap-anywhere">{bot.name}</h2></CardTitle>
                <CardDescription className="wrap-anywhere">{bot.job}</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DashboardPage() {
  return (
    <main className="flex min-h-[calc(100svh-3rem)] min-w-0 flex-1 items-center justify-center px-6">
      <Suspense fallback={<Spinner aria-label="Loading your bots" />}>
        <DashboardContent />
      </Suspense>
    </main>
  );
}
