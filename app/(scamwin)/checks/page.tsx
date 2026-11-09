import type { Metadata } from "next";
import { History } from "@/components/scamwin/history";
export const metadata: Metadata = { title: "My checks" };
export const maxDuration = 300;
export default function Page() { return <History />; }
