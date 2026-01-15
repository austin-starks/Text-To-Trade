import { NextRequest, NextResponse } from "next/server";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";

const SUPPORTED_TOKENS = [
  "ETH",
  "WETH",
  "USDC",
  "USDT",
  "DAI",
  "DEGEN",
  "BRETT",
  "TOSHI",
  "AERO",
  "cbETH",
  "rETH",
];

// JSON Schema for the trade order - used with structured outputs
const TRADE_ORDER_SCHEMA = {
  type: "object",
  properties: {
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
          description: "Confidence score 0-1",
        },
        reasoning: {
          type: "string",
          description: "Brief explanation (keep under 20 words)",
        },
      },
      required: ["action", "sellToken", "buyToken", "sellAmount", "buyAmount", "confidence", "reasoning"],
      additionalProperties: false,
    },
    error: {
      type: "string",
      description: "Error message if order could not be parsed, or empty string if no error",
    },
  },
  required: ["order", "error"],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a trading order parser for a crypto trading app on Base blockchain.
Parse natural language into structured trade orders.

SUPPORTED TOKENS: ${SUPPORTED_TOKENS.join(", ")}

RULES:
- "swap X for Y" = exchange X for Y
- "buy X" = acquire X (pay with USDC)
- "sell X" = sell X (receive USDC)
- Slang: "ape into" = buy, "dump" = sell
- "$" amounts = USD value (use USDC)
- Unsupported token = confidence 0
- Keep reasoning under 20 words`;

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log("[parse-order] Request started");

  try {
    const { input } = await request.json();
    console.log("[parse-order] Input:", input);

    if (!input || typeof input !== "string") {
      return NextResponse.json({ error: "Missing or invalid input" }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "OpenRouter API key not configured" }, { status: 500 });
    }

    console.log("[parse-order] Calling OpenRouter with structured output...");
    const fetchStart = Date.now();

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
          { role: "system", content: SYSTEM_PROMPT },
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

    console.log(`[parse-order] Response in ${Date.now() - fetchStart}ms, status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log("[parse-order] Error:", errorText);
      return NextResponse.json(
        { error: `OpenRouter API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log("[parse-order] Model:", data.model);

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      console.log("[parse-order] No content:", JSON.stringify(data));
      return NextResponse.json({ error: "No response from LLM" }, { status: 500 });
    }

    console.log("[parse-order] Raw content:", content);

    const parsed = JSON.parse(content);
    console.log(`[parse-order] Done in ${Date.now() - startTime}ms`);

    return NextResponse.json({
      success: true,
      ...parsed,
      model: data.model,
      usage: data.usage,
    });
  } catch (error) {
    console.log("[parse-order] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
