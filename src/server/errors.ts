import "server-only";
import { ZodError } from "zod";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function errorResponse(error: unknown) {
  if (error instanceof ZodError)
    return Response.json(
      {
        error: "Check the highlighted values.",
        details: error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 },
    );
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "P2002")
    return Response.json(
      { error: "This slug, SKU, or category link is already in use." },
      { status: 409 },
    );
  if (code === "P2003")
    return Response.json(
      {
        error:
          "This item is still referenced, or a related item no longer exists.",
      },
      { status: 409 },
    );
  if (code === "P2025")
    return Response.json(
      { error: "This item was not found." },
      { status: 404 },
    );
  console.error("FORME request failed", {
    type: error instanceof Error ? error.name : "Unknown",
    code,
  });
  return Response.json(
    {
      error:
        "The service is unavailable. Check that the local database is running.",
    },
    { status: 503 },
  );
}
export async function limitedBytes(request: Request, max: number) {
  if (Number(request.headers.get("content-length")) > max)
    throw new HttpError(413, "The request is too large.");
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  let length = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      throw new HttpError(413, "The request is too large.");
    }
    chunks.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new HttpError(415, "Use application/json.");
  try {
    return JSON.parse(
      new TextDecoder().decode(await limitedBytes(request, 256 * 1024)),
    ) as unknown;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, "Invalid JSON.");
  }
}
