export { MatthewOAuthPlugin } from "./src/plugin.js";

export { createMatthewServer, startMatthewServer } from "./src/server/index.js";
export type { ServerOptions, RunningServer } from "./src/server/index.js";

export { handleMatthewChat, serializeConversation, messageText } from "./src/core/chat.js";
export type {
  OpenAIChatRequest,
  OpenAIMessage,
  OpenAIContentPart,
} from "./src/core/chat.js";

export {
  buildToolInstructions,
  parseToolCalls,
  formatToolCall,
  toolCallDeltas,
  toolNames,
} from "./src/core/tools.js";
export type {
  OpenAITool,
  OpenAIToolCall,
  ToolChoice,
  ParsedReply,
} from "./src/core/tools.js";

export { MATTHEW_MODELS, toOpenAIModelList } from "./src/core/models.js";
export type { MatthewModel } from "./src/core/models.js";

export { printUsageSummary, fetchMatthewUsage } from "./src/core/usage.js";
export type { UsageStats, StoredUsage } from "./src/core/usage.js";

export {
  estimateTokens,
  checkBudget,
  formatBudget,
  compressText,
  pruneContext,
} from "./src/core/tokens.js";
export type { TokenBudget, BudgetStatus } from "./src/core/tokens.js";
