/**
 * OpenAI-format image generation over Matthew. Matthew makes images inside a
 * chat thread when the assistant has image generation on, so this opens a
 * thread with the prompt, waits for it to finish, then reads the image the
 * thread produced. The model name is ignored, as it is for chat: the
 * assistant decides which image model runs.
 */

import { openThread, readWholeReply } from "./chat.js";

export interface OpenAIImageRequest {
  model?: string;
  prompt?: string;
  n?: number;
  response_format?: "url" | "b64_json";
}

interface MatthewImageSource {
  kind?: string;
  url?: string;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleMatthewImages(
  body: OpenAIImageRequest,
  accessToken: string,
  sessionToken: string,
  assistantId: string,
  apiBase: string,
): Promise<Response> {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return jsonResponse(400, { error: { message: "prompt is required" } });
  if (body.n !== undefined && body.n !== 1) {
    return jsonResponse(400, { error: { message: "Only n=1 is supported." } });
  }
  const format = body.response_format ?? "url";
  if (format !== "url" && format !== "b64_json") {
    return jsonResponse(400, { error: { message: "response_format must be url or b64_json" } });
  }

  const opened = await openThread(prompt, accessToken, sessionToken, assistantId, apiBase, "OpenMatthew");
  if ("error" in opened) return opened.error;

  // The image is listed only once the reply has finished, so drain the stream first.
  const drained = await readWholeReply(opened.threadId, accessToken, apiBase);
  if ("error" in drained) return drained.error;

  const sourcesResponse = await fetch(
    `${apiBase}/api/artifacts/image-sources?thread_uuid=${encodeURIComponent(opened.threadId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!sourcesResponse.ok) {
    return jsonResponse(502, {
      error: { message: `Failed to list Matthew images (status ${sourcesResponse.status})` },
    });
  }

  const { images } = (await sourcesResponse.json()) as { images?: MatthewImageSource[] };
  const url = images?.find((image) => image.kind === "generated" && image.url)?.url;
  if (!url) {
    return jsonResponse(502, {
      error: { message: "Matthew returned no generated image. Check that the assistant has image generation on." },
    });
  }

  const created = Math.floor(Date.now() / 1000);
  if (format === "url") {
    return jsonResponse(200, { created, data: [{ url }] });
  }

  const image = await fetch(url);
  if (!image.ok) {
    return jsonResponse(502, { error: { message: `Failed to download image (status ${image.status})` } });
  }
  const b64_json = Buffer.from(await image.arrayBuffer()).toString("base64");
  return jsonResponse(200, { created, data: [{ b64_json }] });
}
