export { MatthewOAuthPlugin } from "./src/plugin.js";

export { createMatthewServer, startMatthewServer } from "./src/server/index.js";
export type { ServerOptions, RunningServer } from "./src/server/index.js";

export { handleMatthewChat, serializeConversation } from "./src/core/chat.js";
export type { OpenAIChatRequest, OpenAIMessage } from "./src/core/chat.js";

export { MATTHEW_MODELS, toOpenAIModelList } from "./src/core/models.js";
export type { MatthewModel } from "./src/core/models.js";
