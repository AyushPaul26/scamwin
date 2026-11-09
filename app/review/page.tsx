import type { Metadata } from "next";
import { Shell } from "@/components/scamwin/core";
import { Review } from "@/components/scamwin/review";
export const metadata: Metadata = { title: "Review queue" };
export const maxDuration = 300;
export default function Page() { return <Shell><Review /></Shell>; }
