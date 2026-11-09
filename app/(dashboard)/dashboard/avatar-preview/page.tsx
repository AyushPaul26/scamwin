import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { CreatureReview } from "@/components/dashboard/creature-review";
import { Spinner } from "@/components/ui/spinner";
import { CREATURE_IDS } from "@/lib/creatures/catalog";

export const metadata: Metadata = { title: "Meet the creatures", robots: { index: false, follow: false } };

type PreviewParams = Promise<{ capture?: string; species?: string }>;

async function ProtectedPreview({ searchParams }: { searchParams: PreviewParams }) {
  const session = await auth0.getSession();
  if (!session?.user.sub) redirect("/sign-in");
  const { capture, species } = await searchParams;
  const initialSpecies = CREATURE_IDS.find((id) => id === species) ?? "moss-otter";
  return <CreatureReview capture={capture === "1"} initialSpecies={initialSpecies} />;
}

export default function AvatarPreviewPage({ searchParams }: { searchParams: PreviewParams }) {
  return (
    <main className="min-w-0 flex-1">
      <Suspense fallback={<div className="flex min-h-dvh items-center justify-center"><Spinner aria-label="Loading creature preview" /></div>}>
        <ProtectedPreview searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
