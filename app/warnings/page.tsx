import type { Metadata } from "next";
import { Warnings } from "@/components/scamwin/warnings";
export const metadata: Metadata = { title: "Shared warnings" };
export default function Page() { return <Warnings />; }
