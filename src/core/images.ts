/**
 * OpenAI-format image generation over Matthew. Matthew makes images inside a
 * chat thread when the assistant has image generation on, so this opens a
 * thread with the prompt, waits for it to finish, then reads the image the
 * thread produced. The model name is ignored, as it is for chat: the
 * assistant decides which image model runs.
 */

import { CLIENT_NAME } from "../constants.js";
import { errorResponse, jsonResponse, openThread, readWholeReply } from "./matthew.js";

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

export async function handleMatthewImages(
  body: OpenAIImageRequest,
  accessToken: string,
  sessionToken: string,
  assistantId: string,
  apiBase: string,
): Promise<Response> {
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return errorResponse(400, "prompt is required");
  if (body.n !== undefined && body.n !== 1) return errorResponse(400, "Only n=1 is supported.");
  const format = body.response_format ?? "url";
  if (format !== "url" && format !== "b64_json") {
    return errorResponse(400, "response_format must be url or b64_json");
  }

  const opened = await openThread(prompt, accessToken, sessionToken, assistantId, apiBase, CLIENT_NAME);
  if ("error" in opened) return opened.error;

  // The image is listed only once the reply has finished, so drain the stream first.
  const drained = await readWholeReply(opened.threadId, accessToken, apiBase);
  if ("error" in drained) return drained.error;

  const sourcesResponse = await fetch(
    `${apiBase}/api/artifacts/image-sources?thread_uuid=${encodeURIComponent(opened.threadId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!sourcesResponse.ok) {
    return errorResponse(502, `Failed to list Matthew images (status ${sourcesResponse.status})`);
  }

  const { images } = (await sourcesResponse.json()) as { images?: MatthewImageSource[] };
  const url = images?.find((image) => image.kind === "generated" && image.url)?.url;
  if (!url) {
    return errorResponse(
      502,
      "Matthew returned no generated image. Check that the assistant has image generation on.",
    );
  }

  const created = Math.floor(Date.now() / 1000);
  if (format === "url") {
    return jsonResponse(200, { created, data: [{ url }] });
  }

  const image = await fetch(url);
  if (!image.ok) {
    return errorResponse(502, `Failed to download image (status ${image.status})`);
  }
  const b64_json = Buffer.from(await image.arrayBuffer()).toString("base64");
  return jsonResponse(200, { created, data: [{ b64_json }] });
}
