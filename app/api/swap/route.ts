import { NextRequest, NextResponse } from "next/server";

const BASE_CHAIN_ID = 8453;
const INCH_API_BASE = "https://api.1inch.dev/swap/v6.0";

interface SwapRequest {
  src: string;       // Source token address
  dst: string;       // Destination token address  
  amount: string;    // Amount in wei
  from: string;      // User's wallet address
  slippage: number;  // Slippage tolerance (e.g., 1 for 1%)
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log("[swap] Request started");

  try {
    const body: SwapRequest = await request.json();
    console.log("[swap] Request body:", body);

    const { src, dst, amount, from, slippage } = body;

    if (!src || !dst || !amount || !from) {
      return NextResponse.json(
        { error: "Missing required fields: src, dst, amount, from" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ONEINCH_API_KEY;
    if (!apiKey) {
      console.log("[swap] No 1inch API key - returning mock swap data");
      // Return mock data for development
      return NextResponse.json({
        success: true,
        mock: true,
        tx: {
          from,
          to: "0x111111125421ca6dc452d289314280a0f8842a65", // 1inch router
          data: "0x...", // Would be real calldata
          value: src.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ? amount : "0",
          gas: "300000",
          gasPrice: "1000000000",
        },
        srcAmount: amount,
        dstAmount: "1000000000000000000", // Mock 1 ETH worth
      });
    }

    // Build 1inch swap URL
    const url = new URL(`${INCH_API_BASE}/${BASE_CHAIN_ID}/swap`);
    url.searchParams.set("src", src);
    url.searchParams.set("dst", dst);
    url.searchParams.set("amount", amount);
    url.searchParams.set("from", from);
    // Use higher slippage for volatile tokens - 5% default to handle meme coins
    url.searchParams.set("slippage", slippage?.toString() || "5");
    url.searchParams.set("disableEstimate", "true"); // Skip on-chain simulation
    url.searchParams.set("allowPartialFill", "false"); // Ensure full fill or fail

    console.log("[swap] Calling 1inch API:", url.toString());
    const fetchStart = Date.now();

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    console.log(`[swap] 1inch responded in ${Date.now() - fetchStart}ms, status: ${response.status}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.log("[swap] 1inch error:", errorText);
      return NextResponse.json(
        { error: `1inch API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log(`[swap] Complete in ${Date.now() - startTime}ms`);

    return NextResponse.json({
      success: true,
      tx: data.tx,
      srcAmount: data.srcAmount,
      dstAmount: data.dstAmount,
      protocols: data.protocols,
    });
  } catch (error) {
    console.log("[swap] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// GET endpoint for quotes (no wallet needed)
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const src = searchParams.get("src");
  const dst = searchParams.get("dst");
  const amount = searchParams.get("amount");

  console.log("[quote] Request:", { src, dst, amount });

  if (!src || !dst || !amount) {
    return NextResponse.json(
      { error: "Missing required params: src, dst, amount" },
      { status: 400 }
    );
  }

  const apiKey = process.env.ONEINCH_API_KEY;
  if (!apiKey) {
    console.log("[quote] No API key - returning mock quote");
    return NextResponse.json({
      success: true,
      mock: true,
      srcAmount: amount,
      dstAmount: "1000000000000000000",
      gas: 150000,
    });
  }

  try {
    const url = new URL(`${INCH_API_BASE}/${BASE_CHAIN_ID}/quote`);
    url.searchParams.set("src", src);
    url.searchParams.set("dst", dst);
    url.searchParams.set("amount", amount);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `1inch API error: ${response.status} - ${errorText}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      success: true,
      srcAmount: data.srcAmount,
      dstAmount: data.dstAmount,
      gas: data.gas,
      protocols: data.protocols,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

