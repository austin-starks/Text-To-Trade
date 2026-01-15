import { NextRequest, NextResponse } from "next/server";
import { getTokenSymbolsList } from "../../lib/token-list";
import { STRATEGY_DEFAULTS } from "../../types/strategy";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

// JSON Schema for strategy parsing
const STRATEGY_SCHEMA = {
  type: "object",
  properties: {
    success: {
      type: "boolean",
      description: "Whether the strategy was successfully parsed",
    },
    name: {
      type: "string",
      description: "Short name for the strategy (under 30 chars)",
    },
    description: {
      type: "string",
      description: "Human-readable description of what the strategy does",
    },
    condition: {
      type: "object",
      description: "For base conditions: use lhs, rhs, comparison (set operator/conditions to null). For compound: use operator, conditions (set lhs/rhs/comparison to null).",
      properties: {
        type: {
          type: "string",
          enum: ["base", "compound"],
        },
        // For base conditions (null for compound)
        lhs: {
          type: ["object", "null"],
          properties: {
            type: { type: "string", enum: ["price", "balance", "constant"] },
            token: { type: ["string", "null"], description: "Token symbol for price/balance types, null for constant" },
            value: { type: ["number", "null"], description: "Numeric value for constant type, null for price/balance" },
          },
          required: ["type", "token", "value"],
          additionalProperties: false,
        },
        rhs: {
          type: ["object", "null"],
          properties: {
            type: { type: "string", enum: ["price", "balance", "constant"] },
            token: { type: ["string", "null"], description: "Token symbol for price/balance types, null for constant" },
            value: { type: ["number", "null"], description: "Numeric value for constant type, null for price/balance" },
          },
          required: ["type", "token", "value"],
          additionalProperties: false,
        },
        comparison: {
          type: ["string", "null"],
          enum: ["greater_than", "less_than", "greater_than_or_equal", "less_than_or_equal", "equal", "crosses_above", "crosses_below", null],
        },
        // For compound conditions (null for base)
        operator: {
          type: ["string", "null"],
          enum: ["and", "or", null],
        },
        conditions: {
          type: ["array", "null"],
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["base"] },
              lhs: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["price", "balance", "constant"] },
                  token: { type: ["string", "null"] },
                  value: { type: ["number", "null"] },
                },
                required: ["type", "token", "value"],
                additionalProperties: false,
              },
              rhs: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["price", "balance", "constant"] },
                  token: { type: ["string", "null"] },
                  value: { type: ["number", "null"] },
                },
                required: ["type", "token", "value"],
                additionalProperties: false,
              },
              comparison: {
                type: "string",
                enum: ["greater_than", "less_than", "greater_than_or_equal", "less_than_or_equal", "equal", "crosses_above", "crosses_below"],
              },
            },
            required: ["type", "lhs", "rhs", "comparison"],
            additionalProperties: false,
          },
        },
      },
      required: ["type", "lhs", "rhs", "comparison", "operator", "conditions"],
      additionalProperties: false,
    },
    action: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["swap", "alert"],
        },
        sellToken: { type: ["string", "null"], description: "Token to sell (for swap type)" },
        buyToken: { type: ["string", "null"], description: "Token to buy (for swap type)" },
        sellAmount: { type: ["string", "null"], description: "Fixed amount to sell (for swap type)" },
        sellPercentage: { type: ["number", "null"], description: "Percentage of balance to sell (for swap type)" },
        message: { type: ["string", "null"], description: "Alert message (for alert type)" },
      },
      required: ["type", "sellToken", "buyToken", "sellAmount", "sellPercentage", "message"],
      additionalProperties: false,
    },
    // Recurring configuration
    isRecurring: {
      type: "boolean",
      description: "True if strategy should trigger multiple times (e.g., 'every time', 'whenever'). Default false for one-time triggers.",
    },
    maxExecutions: {
      type: "number",
      description: "Maximum number of times strategy can trigger. 0 = unlimited (for recurring). Default 1 for one-time.",
    },
    cooldownHours: {
      type: "number",
      description: "Hours to wait between triggers for recurring strategies. Default 4 hours. Common values: 1, 4, 12, 24.",
    },
    error: {
      type: "string",
      description: "Error message if parsing failed",
    },
    reasoning: {
      type: "string",
      description: "Brief explanation of how the strategy was parsed",
    },
  },
  required: ["success", "name", "description", "condition", "action", "isRecurring", "maxExecutions", "cooldownHours", "error", "reasoning"],
  additionalProperties: false,
};

function buildSystemPrompt(tokenSymbols: string[]): string {
  return `You are a trading strategy parser for a crypto trading app on Base blockchain.
Your job is to convert natural language descriptions of trading strategies into structured conditions and actions.

SUPPORTED TOKENS (from 1inch DEX - real prices):
All tokens tradeable on Base DEXs are supported. Common ones:
ETH, WETH, USDC, USDT, DAI, cbBTC, AERO, DEGEN, BRETT, TOSHI, VIRTUAL, HIGHER, WELL, USDbC

TOKEN ALIASES:
- "BTC" or "Bitcoin" → use "cbBTC" (Coinbase Wrapped BTC on Base)
- "stables" or "dollars" → use "USDC"
- Always output actual token symbols

INDICATOR TYPES:
- price: Current token price in USD (REAL DATA from 1inch DEX)
- balance: User's token balance (REAL DATA from on-chain)
- constant: A fixed number (e.g., "$3000", "0.5")

NOTE: price_change is NOT supported (no historical data available).

COMPARISON OPERATORS:
- greater_than: >
- less_than: <
- greater_than_or_equal: >=
- less_than_or_equal: <=
- equal: ==
- crosses_above: when value goes from below to above threshold
- crosses_below: when value goes from above to below threshold

ACTION TYPES:
- swap: Exchange one token for another
  - sellToken: Token to sell
  - buyToken: Token to receive
  - sellAmount: Fixed amount (e.g., "100")
  - sellPercentage: Percentage of balance (e.g., 50 for 50%)
- alert: Just notify the user (for now)

EXAMPLES:
1. "Buy ETH when it drops below $3000"
   → condition: { type: "base", lhs: { type: "price", token: "ETH" }, rhs: { type: "constant", value: 3000 }, comparison: "less_than" }
   → action: { type: "swap", sellToken: "USDC", buyToken: "ETH", sellPercentage: 10 }

2. "Sell half my ETH if it goes above $4000"
   → condition: { type: "base", lhs: { type: "price", token: "ETH" }, rhs: { type: "constant", value: 4000 }, comparison: "greater_than" }
   → action: { type: "swap", sellToken: "ETH", buyToken: "USDC", sellPercentage: 50 }

3. "Alert me when cbBTC drops below $90,000"
   → condition: { type: "base", lhs: { type: "price", token: "cbBTC" }, rhs: { type: "constant", value: 90000 }, comparison: "less_than" }
   → action: { type: "alert", message: "cbBTC has dropped below $90,000!" }

4. "Buy DEGEN if ETH > $3500 and DEGEN < $0.01"
   → condition: { type: "compound", operator: "and", conditions: [...] }

RECURRING STRATEGIES:
- isRecurring: true = strategy can trigger multiple times with a cooldown
- isRecurring: false = strategy triggers once and stops (one-time, default)
- Keywords that indicate recurring: "every time", "whenever", "each time", "always", "continuously", "repeatedly"
- Keywords that indicate one-time: "once", "first time", "when" (without "every/whenever")
- maxExecutions: 0 = unlimited (for recurring), 1 = one-time (default)
- cooldownHours: Time between recurring triggers (default 4 hours)

EXAMPLES OF RECURRING VS ONE-TIME:
- "Buy ETH when it drops below $3000" → isRecurring: false, maxExecutions: 1 (one-time)
- "Buy ETH every time it drops below $3000" → isRecurring: true, maxExecutions: 0, cooldownHours: 4
- "Alert me whenever BTC drops 5%" → isRecurring: true, maxExecutions: 0, cooldownHours: 4
- "Sell ETH once when it hits $5000" → isRecurring: false, maxExecutions: 1

RULES:
- For "buy X" without specifying sell token, default to selling USDC
- For "sell X" without specifying buy token, default to receiving USDC
- If no amount specified, use sellPercentage: 10 (10% of balance)
- Keep descriptions clear and concise
- Use the actual token symbols from the supported list
- price_change values should be percentages (e.g., -10 for 10% drop)
- Default to one-time (isRecurring: false) unless user explicitly says recurring words`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { input, ownerAddress } = body as { 
      input: string; 
      ownerAddress: string;
    };

    if (!input || typeof input !== "string") {
      return NextResponse.json({ success: false, error: "Missing or invalid input" }, { status: 400 });
    }

    if (!ownerAddress) {
      return NextResponse.json({ success: false, error: "Wallet address required" }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ success: false, error: "OpenRouter API key not configured" }, { status: 500 });
    }

    // Fetch supported tokens
    const tokenSymbols = await getTokenSymbolsList();
    const systemPrompt = buildSystemPrompt(tokenSymbols);

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
          { role: "user", content: `Parse this trading strategy: "${input}"` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "trading_strategy",
            strict: true,
            schema: STRATEGY_SCHEMA,
          },
        },
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { success: false, error: `API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      return NextResponse.json({ success: false, error: "No response from LLM" }, { status: 500 });
    }

    const parsed = JSON.parse(content);

    if (!parsed.success) {
      return NextResponse.json({
        success: false,
        error: parsed.error || "Failed to parse strategy",
        reasoning: parsed.reasoning,
      });
    }

    // Determine recurring configuration with defaults
    const isRecurring = parsed.isRecurring ?? false;
    const defaults = isRecurring ? STRATEGY_DEFAULTS.RECURRING : STRATEGY_DEFAULTS.ONE_TIME;
    
    // Convert cooldownHours to milliseconds (default from preset)
    const cooldownMs = parsed.cooldownHours 
      ? parsed.cooldownHours * 60 * 60 * 1000 
      : defaults.cooldownMs;
    
    // Construct the full strategy object
    const strategy = {
      id: crypto.randomUUID(),
      name: parsed.name,
      description: parsed.description,
      condition: parsed.condition,
      action: parsed.action,
      status: "active",
      createdAt: new Date().toISOString(),
      executionCount: 0,
      ownerAddress,
      // Recurring/cooldown configuration
      isRecurring,
      maxExecutions: parsed.maxExecutions ?? defaults.maxExecutions,
      cooldownMs,
    };

    return NextResponse.json({
      success: true,
      strategy,
      reasoning: parsed.reasoning,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

