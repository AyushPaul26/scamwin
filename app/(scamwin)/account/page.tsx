import type { Metadata } from "next";
import { Account } from "@/components/scamwin/account";
export const metadata: Metadata = { title: "Account & privacy" };
export default function Page() { return <Account />; }
