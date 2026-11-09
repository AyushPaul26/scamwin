import { z } from "zod";
import { mintChatAccessToken, startChatSession } from "@/app/chats/actions";
import { chatIdSchema } from "@/lib/chat-input";

const headers = { "Cache-Control": "private, no-store" };
const inputSchema = z.object({ recipientId: chatIdSchema.optional() });
type Context = { params: Promise<{ chatId: string }> };

// These connection operations return credentials only; the action transport
// would also re-render the entire transcript when the session cookie rolls.
export async function GET(_request: Request, { params }: Context) {
  try {
    const { chatId } = await params;
    return Response.json({ publicAccessToken: await mintChatAccessToken(chatId) }, { headers });
  } catch {
    return Response.json({ error: "Couldn’t reconnect to this chat. Please try again." }, { status: 403, headers });
  }
}

export async function POST(request: Request, { params }: Context) {
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ error: "Chat unavailable." }, { status: 403, headers });
  }
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "Invalid recipient." }, { status: 400, headers });
  try {
    const { chatId } = await params;
    return Response.json(await startChatSession({ chatId, recipientId: input.data.recipientId }), { headers });
  } catch {
    return Response.json({ error: "Couldn’t start the reply. Please try again." }, { status: 403, headers });
  }
}
