export const AUTH_RETURN_TO = "/check";

export const authProviders = [
  {
    id: "email",
    name: "Email",
    connection: "Username-Password-Authentication",
  },
  {
    id: "google",
    name: "Google",
    connection: "google-oauth2",
  },
  {
    id: "gitlab",
    name: "GitLab",
    connection: "gitlab",
  },
  {
    id: "github",
    name: "GitHub",
    connection: "github",
  },
  {
    id: "bitbucket",
    name: "Bitbucket",
    connection: "bitbucket",
  },
] as const;

export type AuthProviderId = (typeof authProviders)[number]["id"];

export function authLoginHref(
  mode: "signin" | "signup",
  connection: string,
) {
  const params = new URLSearchParams({
    connection,
    returnTo: AUTH_RETURN_TO,
  });

  if (mode === "signup") {
    params.set("screen_hint", "signup");
  }

  return `/auth/login?${params.toString()}`;
}
