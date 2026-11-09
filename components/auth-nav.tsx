import Link from "next/link";
import { getOptionalSession } from "@/lib/auth0";

export function AuthNavFallback() {
  return <AuthNavBar />;
}

export async function AuthNav() {
  const session = await getOptionalSession();
  const user = session?.user;

  return (
    <AuthNavBar
      name={user?.name ?? user?.email}
      picture={typeof user?.picture === "string" ? user.picture : undefined}
    />
  );
}

function AuthNavBar({
  name,
  picture,
}: {
  name?: string;
  picture?: string;
}) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-black/[.08] px-6 py-4 dark:border-white/[.145]">
      <Link
        href="/"
        className="text-sm font-semibold tracking-tight text-black dark:text-zinc-50"
      >
        OpenMods
      </Link>
      {name ? (
        <div className="flex items-center gap-3">
          {picture ? (
            <img
              src={picture}
              alt=""
              className="h-8 w-8 rounded-full"
            />
          ) : null}
          <span className="max-w-40 truncate text-sm text-zinc-700 dark:text-zinc-300">
            {name}
          </span>
          <a
            href="/auth/logout"
            className="inline-flex h-10 items-center justify-center rounded-full border border-black/[.08] px-4 text-sm font-medium text-black transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
          >
            Log out
          </a>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            className="inline-flex h-10 items-center justify-center rounded-full border border-black/[.08] px-4 text-sm font-medium text-black transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:text-zinc-50 dark:hover:bg-[#1a1a1a]"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="inline-flex h-10 items-center justify-center rounded-full bg-foreground px-4 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Sign up
          </Link>
        </div>
      )}
    </header>
  );
}
