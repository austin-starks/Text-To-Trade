import { NextRequest, NextResponse } from "next/server";
import { getTokenSymbolsList } from "../../lib/token-list";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// JSON Schema for the trade order - used with structured outputs
const TRADE_ORDER_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["trade", "question"],
      description: "Whether the user wants to make a trade or is asking a question",
    },
    answer: {
      type: "string",
      description: "If intent is 'question', provide a helpful answer. Otherwise empty string.",
    },
    order: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["swap", "buy", "sell"],
          description: "The type of trade action",
        },
        sellToken: {
          type: "string",
          description: "Token symbol to sell",
        },
        buyToken: {
          type: "string",
          description: "Token symbol to buy",
        },
        sellAmount: {
          type: "string",
          description: "Amount to sell as a string, or empty string if not specified",
        },
        buyAmount: {
          type: "string",
          description: "Amount to buy as a string, or empty string if not specified",
        },
        confidence: {
          type: "number",
          description: "Confidence score 0-1. Set to 0 if user lacks sufficient balance.",
        },
        reasoning: {
          type: "string",
          description: "Brief explanation (keep under 20 words)",
        },
      },
      required: ["action", "sellToken", "buyToken", "sellAmount", "buyAmount", "confidence", "reasoning"],
      additionalProperties: false,
    },
    balanceCheck: {
      type: "object",
      properties: {
        hasSufficientBalance: {
          type: "boolean",
          description: "Whether user has enough of the sell token",
        },
        availableBalance: {
          type: "string",
          description: "User's balance of the sell token, or empty if unknown",
        },
        shortfall: {
          type: "string",
          description: "How much more is needed, or empty string if sufficient",
        },
      },
      required: ["hasSufficientBalance", "availableBalance", "shortfall"],
      additionalProperties: false,
    },
    suggestion: {
      type: "object",
      properties: {
        hasAlternative: {
          type: "boolean",
          description: "Whether there's a suggested alternative trade",
        },
        alternativeAction: {
          type: "string",
          description: "Suggested alternative action description, or empty string",
        },
        alternativeSellToken: {
          type: "string",
          description: "Alternative token to sell, or empty string",
        },
        alternativeSellAmount: {
          type: "string",
          description: "Alternative amount to sell, or empty string",
        },
        alternativeBuyToken: {
          type: "string",
          description: "Alternative token to buy, or empty string",
        },
      },
      required: ["hasAlternative", "alternativeAction", "alternativeSellToken", "alternativeSellAmount", "alternativeBuyToken"],
      additionalProperties: false,
    },
    error: {
      type: "string",
      description: "Error message if order could not be parsed, or empty string if no error",
    },
  },
  required: ["intent", "answer", "order", "balanceCheck", "suggestion", "error"],
  additionalProperties: false,
};

// Common token aliases that users might say
const TOKEN_ALIASES: Record<string, string> = {
  // Bitcoin variants - use cbBTC (Coinbase Wrapped BTC) on Base
  "BTC": "cbBTC",
  "BITCOIN": "cbBTC",
  "WRAPPED BITCOIN": "cbBTC",
  "WBTC": "cbBTC", // Redirect WBTC requests to cbBTC on Base
  // Ethereum variants  
  "ETHEREUM": "ETH",
  "ETHER": "ETH",
  // Stablecoins
  "USDC": "USDC",
  "USD": "USDC",
  "DOLLARS": "USDC",
  "DOLLAR": "USDC",
  "STABLES": "USDC",
  "STABLE": "USDC",
  "TETHER": "USDT",
  // Other common names
  "WRAPPED ETH": "WETH",
  "WRAPPED ETHER": "WETH",
};

function buildSystemPrompt(tokenSymbols: string[], portfolio?: string): string {
  // Build alias instructions
  const aliasExamples = Object.entries(TOKEN_ALIASES)
    .filter(([alias, token]) => alias !== token && tokenSymbols.includes(token))
    .slice(0, 10) // Limit to keep prompt size reasonable
    .map(([alias, token]) => `"${alias}" → ${token}`)
    .join(", ");

  const basePrompt = `You are a trading assistant for a crypto trading app on Base blockchain.
You can parse trade orders AND answer questions about the app.

SUPPORTED TOKENS (${tokenSymbols.length} total):
${tokenSymbols.join(", ")}

TOKEN ALIASES (auto-convert these):
${aliasExamples}
- If user says a common name, convert to the actual token symbol
- "BTC" or "Bitcoin" → use cbBTC (Coinbase Wrapped BTC on Base)
- "stables" or "dollars" → use USDC

INTENT DETECTION:
- If user asks a question (e.g., "what tokens?", "how does this work?", "help"), set intent="question" and provide a helpful answer
- If user wants to trade (e.g., "swap X for Y", "buy X", "sell X"), set intent="trade" and parse the order
- For questions, keep answers concise (under 100 words) and friendly

TRADE RULES:
- "swap X for Y" = exchange X for Y
- "buy X" = acquire X (pay with USDC by default, or ETH if specified)
- "sell X" = sell X (receive USDC)
- Slang: "ape into" = buy aggressively, "dump" = sell, "stack" = buy, "yolo" = buy all-in
- "$" amounts = USD value (use USDC)
- ALWAYS output the actual token symbol (e.g., cbBTC not BTC, USDC not USD)
- If token not in supported list, set confidence to 0
- Keep reasoning under 20 words`;

  const portfolioInstructions = portfolio
    ? `

${portfolio}

BALANCE VALIDATION:
- Check if user has sufficient balance for the sell token
- If insufficient balance, set confidence to 0.3 and suggest alternatives
- NEVER suggest swapping a token for itself (e.g., "swap ETH for ETH" is invalid)
- If user wants to buy X but has no sell token, suggest using their largest holding to buy X
- The alternative sell token must be DIFFERENT from the buy token
- Example: User wants "1 cbBTC → ETH" but has no cbBTC, has 0.002 ETH → suggest "swap 0.001 ETH for cbBTC" (buying what they originally wanted to sell)
- Always be helpful and suggest what IS possible with their portfolio`
    : `

Portfolio: Not connected (skip balance validation, set hasSufficientBalance to true)`;

  return basePrompt + portfolioInstructions;
}

interface PortfolioBalance {
  symbol: string;
  balance: string;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    const body = await request.json();
    const { input, portfolio } = body as { 
      input: string; 
      portfolio?: PortfolioBalance[];
    };

    if (!input || typeof input !== "string") {
      return NextResponse.json({ error: "Missing or invalid input" }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenRouter API key not configured" }, { status: 500 });
    }

    // Fetch supported tokens (cached)
    const tokenSymbols = await getTokenSymbolsList();

    // Format portfolio for prompt
    let portfolioText: string | undefined;
    if (portfolio && portfolio.length > 0) {
      const nonZero = portfolio.filter((b) => parseFloat(b.balance) > 0);
      if (nonZero.length > 0) {
        const lines = nonZero.map((b) => `- ${b.symbol}: ${parseFloat(b.balance).toFixed(6)}`);
        portfolioText = `User's Portfolio:\n${lines.join("\n")}`;
      } else {
        portfolioText = "User's Portfolio: Empty (no tokens)";
      }
    }

    const systemPrompt = buildSystemPrompt(tokenSymbols, portfolioText);

    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://text-to-trade.vercel.app",
        "X-Title": "Text to Trade",
      },
      body: JSON.stringify({
        model: "openai/gpt-5-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Parse this trade: "${input}"` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "trade_order",
            strict: true,
            schema: TRADE_ORDER_SCHEMA,
          },
        },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `OpenRouter API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return NextResponse.json({ error: "No response from LLM" }, { status: 500 });
    }

    const parsed = JSON.parse(content);

    return NextResponse.json({
      success: true,
      ...parsed,
      model: data.model,
      usage: data.usage,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
