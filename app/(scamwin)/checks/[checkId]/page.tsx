import type { Metadata } from "next";
import { CheckDetail } from "@/components/scamwin/result";
export const metadata: Metadata = { title: "Check evidence" };
export const maxDuration = 300;
export default async function Page({ params }: { params: Promise<{ checkId: string }> }) { const { checkId } = await params; return <CheckDetail id={checkId} />; }
