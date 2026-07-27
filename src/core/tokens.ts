/**
 * Lightweight token estimation without external deps.
 *
 * Rules of thumb:
 *   English   ~ 1 token per 4 chars
 *   Thai/CJK  ~ 1.5 tokens per char
 *   Code      ~ 1 token per 3-4 chars (more whitespace/punctuation)
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  let tokens = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    if ((code >= 0x4e00 && code <= 0x9fff) ||       // CJK
        (code >= 0x0e00 && code <= 0x0e7f) ||       // Thai
        (code >= 0xac00 && code <= 0xd7af)) {       // Korean
      tokens += 1.5;
    } else if (code < 0x80) {
      tokens += 0.25; // ASCII
    } else {
      tokens += 0.5;  // Other Unicode
    }
  }
  return Math.ceil(tokens);
}

export interface TokenBudget {
  /** Context token budget (Matthew: 9_000_000) */
  contextLimit: number;
  /** Response token budget (Matthew: 3_000_000) */
  responseLimit: number;
  /** Warning threshold (0-1) */
  warnThreshold: number;
}

const MATTHEW_DEFAULT_BUDGET: TokenBudget = {
  contextLimit: 9_000_000,
  responseLimit: 3_000_000,
  warnThreshold: 0.8,
};

export function getBudget(): TokenBudget {
  const ctx = parseInt(process.env.MATTHEW_CONTEXT_LIMIT || "", 10);
  const res = parseInt(process.env.MATTHEW_RESPONSE_LIMIT || "", 10);
  return {
    contextLimit: Number.isFinite(ctx) ? ctx : MATTHEW_DEFAULT_BUDGET.contextLimit,
    responseLimit: Number.isFinite(res) ? res : MATTHEW_DEFAULT_BUDGET.responseLimit,
    warnThreshold: MATTHEW_DEFAULT_BUDGET.warnThreshold,
  };
}

export interface BudgetStatus {
  contextUsed: number;
  contextLimit: number;
  responseUsed: number;
  responseLimit: number;
  contextPct: number;
  responsePct: number;
  warnings: string[];
}

export function checkBudget(
  contextUsed: number,
  responseUsed: number,
  budget: TokenBudget = getBudget(),
): BudgetStatus {
  const ctxPct = contextUsed / budget.contextLimit;
  const resPct = responseUsed / budget.responseLimit;
  const warnings: string[] = [];

  if (ctxPct >= budget.warnThreshold) {
    warnings.push(
      `Context usage at ${(ctxPct * 100).toFixed(1)}% (${contextUsed.toLocaleString()} / ${budget.contextLimit.toLocaleString()})`,
    );
  }
  if (resPct >= budget.warnThreshold) {
    warnings.push(
      `Response usage at ${(resPct * 100).toFixed(1)}% (${responseUsed.toLocaleString()} / ${budget.responseLimit.toLocaleString()})`,
    );
  }

  return {
    contextUsed,
    contextLimit: budget.contextLimit,
    responseUsed,
    responseLimit: budget.responseLimit,
    contextPct: ctxPct,
    responsePct: resPct,
    warnings,
  };
}

export function formatBudget(status: BudgetStatus): string {
  const lines = [
    `[matthew] Token budget:`,
    `  Context:  ${status.contextUsed.toLocaleString()} / ${status.contextLimit.toLocaleString()} (${(status.contextPct * 100).toFixed(1)}%)`,
    `  Response: ${status.responseUsed.toLocaleString()} / ${status.responseLimit.toLocaleString()} (${(status.responsePct * 100).toFixed(1)}%)`,
  ];
  if (status.warnings.length) {
    lines.push(`  ⚠️  ${status.warnings.join("; ")}`);
  }
  return lines.join("\n");
}

/**
 * Summarize a long text by extracting first N and last N sentences
 * with a "..." gap. Useful for compressing conversation history.
 */
export function compressText(text: string, keepFirstTokens = 200, keepLastTokens = 100): string {
  const total = estimateTokens(text);
  const keepTotal = keepFirstTokens + keepLastTokens;
  if (total <= keepTotal) return text;

  // Very naive sentence split — good enough for compression hints
  const sentences = text.split(/(?<=[.!?。！？]\s)/);
  let first = "";
  let last = "";
  let firstTokens = 0;
  let lastTokens = 0;

  for (const s of sentences) {
    const t = estimateTokens(s);
    if (firstTokens + t <= keepFirstTokens) {
      first += s;
      firstTokens += t;
    } else {
      break;
    }
  }

  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i];
    if (!s) continue;
    const t = estimateTokens(s);
    if (lastTokens + t <= keepLastTokens) {
      last = s + last;
      lastTokens += t;
    } else {
      break;
    }
  }

  return `${first}\n... [${total - firstTokens - lastTokens} tokens omitted] ...\n${last}`;
}

/**
 * Optimize a codebase context string by removing obvious noise.
 */
export function pruneContext(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")          // block comments
    .replace(/(^|\n)\s*\/\/.*$/gm, "")         // line comments
    .replace(/\n{3,}/g, "\n\n")                 // collapse blank lines
    .replace(/    /g, "  ")                     // 4-space → 2-space indent
    .trim();
}
