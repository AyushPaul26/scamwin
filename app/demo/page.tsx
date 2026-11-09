import type { Metadata } from "next";
import { Shell } from "@/components/scamwin/core";
import { Demo } from "@/components/scamwin/demo";
export const metadata: Metadata = { title: "Synthetic sample" };
export default function Page() { return <Shell><Demo /></Shell>; }
