import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth-screen";

export const metadata: Metadata = { title: "Sign up" };

export default function Page() {
  return <AuthScreen mode="signup" />;
}
