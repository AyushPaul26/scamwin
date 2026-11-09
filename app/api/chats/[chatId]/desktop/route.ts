import { getDesktopAccess } from "@/lib/desktop-access";

// A connection request must not re-render the chat or reload its transcript.
// Keep this POST: it can resume the computer and start its desktop service.
export async function POST(request: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Desktop unavailable." }, { status: 403, headers });
  }
  try {
    const { chatId } = await params;
    return Response.json(await getDesktopAccess(chatId), { headers });
  } catch {
    return Response.json({ error: "Could not connect to this desktop. Please retry." }, { status: 403, headers });
  }
}
