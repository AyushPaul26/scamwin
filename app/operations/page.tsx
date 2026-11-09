import type { Metadata } from "next";
import { Shell } from "@/components/scamwin/core";
import { Operations } from "@/components/scamwin/operations";
export const metadata: Metadata = { title: "Operations readiness" };
export default function Page() { return <Shell><Operations /></Shell>; }
