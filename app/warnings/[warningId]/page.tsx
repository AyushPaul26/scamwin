import type { Metadata } from "next";
import { WarningDetail } from "@/components/scamwin/warnings";
export const metadata: Metadata = { title: "Warning details" };
export default async function Page({ params }: { params: Promise<{ warningId: string }> }) { const { warningId } = await params; return <WarningDetail id={warningId} />; }
