import { loadChatHistory } from "@/app/chats/actions";

export async function GET(_request: Request, { params }: { params: Promise<{ chatId: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const { chatId } = await params;
    const { messages } = await loadChatHistory(chatId);
    return Response.json({ messages }, { headers });
  } catch {
    return Response.json({ error: "Couldn’t load this chat. Please try again." }, { status: 403, headers });
  }
}
