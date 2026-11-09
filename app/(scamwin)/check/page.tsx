import type { Metadata } from "next";
import { Intake } from "@/components/scamwin/intake";
export const metadata: Metadata = { title: "New check" };
export const maxDuration = 300;
export default function Page() { return <Intake />; }
