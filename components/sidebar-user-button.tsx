"use client";

import { useRef, useState } from "react";
import { ChevronsUpDownIcon, LogOutIcon, ShieldCheckIcon, UserRoundIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

type AccountProfile = {
  name: string;
  email?: string;
  picture?: string;
  emailVerified?: boolean;
};

function ProfileAvatar({ profile, large = false }: { profile: AccountProfile; large?: boolean }) {
  const initials = profile.name.split(/\s+/).slice(0, 2).map((part) => Array.from(part)[0]).join("").toLocaleUpperCase();
  return (
    <Avatar size={large ? "lg" : "default"}>
      {profile.picture && <AvatarImage src={profile.picture} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback>{initials}</AvatarFallback>
    </Avatar>
  );
}

export function SidebarUserButton({ profile }: { profile: AccountProfile }) {
  const [profileOpen, setProfileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger render={<SidebarMenuButton size="lg" ref={triggerRef} tooltip={profile.name} className="rounded-xl group-data-[collapsible=icon]:size-10! group-data-[collapsible=icon]:justify-center" />} aria-label={`Account menu for ${profile.name}`}>
              <ProfileAvatar profile={profile} />
              <span className="grid min-w-0 flex-1 gap-0.5 text-left group-data-[collapsible=icon]:hidden">
                <span className="truncate font-medium">{profile.name}</span>
                {profile.email && <span className="truncate text-xs text-muted-foreground">{profile.email}</span>}
              </span>
              <ChevronsUpDownIcon aria-hidden="true" className="group-data-[collapsible=icon]:hidden" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="start" sideOffset={8} className="dark dashboard-theme w-72 max-w-[calc(100vw-2rem)]">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <span className="flex items-center gap-3 py-2">
                    <ProfileAvatar profile={profile} large />
                    <span className="grid min-w-0 gap-1">
                      <span className="truncate text-sm text-foreground">{profile.name}</span>
                      <span className="truncate text-xs font-normal text-muted-foreground">{profile.email ?? "Signed in"}</span>
                    </span>
                  </span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setProfileOpen(true)}><UserRoundIcon />View profile</DropdownMenuItem>
                <DropdownMenuItem render={<a href="/auth/logout" />}><LogOutIcon />Sign out</DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                <ShieldCheckIcon className="size-3.5" aria-hidden="true" />Secured by Auth0
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
      <DialogContent className="dark dashboard-theme max-h-[calc(100dvh-2rem)] overflow-y-auto" finalFocus={triggerRef}>
        <DialogHeader>
          <DialogTitle>Your profile</DialogTitle>
          <DialogDescription>Your account details from your sign-in provider.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <ProfileAvatar profile={profile} large />
          <p className="min-w-0 wrap-anywhere font-medium">{profile.name}</p>
        </div>
        <dl className="grid gap-4 rounded-lg border p-4 text-sm">
          <div className="grid gap-1"><dt className="text-muted-foreground">Name</dt><dd className="wrap-anywhere">{profile.name}</dd></div>
          <div className="grid gap-1"><dt className="text-muted-foreground">Email</dt><dd className="wrap-anywhere">{profile.email ?? "Not provided"}</dd></div>
          {profile.email && <div className="grid gap-1"><dt className="text-muted-foreground">Email verification</dt><dd>{profile.emailVerified === true ? "Verified" : profile.emailVerified === false ? "Not verified" : "Not provided"}</dd></div>}
          <div className="grid gap-1"><dt className="text-muted-foreground">Authentication</dt><dd>Auth0</dd></div>
        </dl>
        <DialogFooter>
          <Button variant="outline" nativeButton={false} render={<a href="/auth/logout" />}><LogOutIcon data-icon="inline-start" />Sign out</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
