import { NextRequest, NextResponse } from "next/server";

const ZEROX_API_BASE = "https://api.0x.org/swap";

interface SwapRequest {
  src: string; // Source token address
  dst: string; // Destination token address
  amount: string; // Amount in wei
  from: string; // User's wallet address
  slippage: number; // Slippage tolerance in bps (e.g., 100 for 1%)
  chainId?: number; // Chain ID (default: 8453 for Base)
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log("[swap] Request started");

  try {
    const body: SwapRequest = await request.json();
    console.log("[swap] Request body:", body);

    const { src, dst, amount, from, slippage, chainId = 8453 } = body;

    if (!src || !dst || !amount || !from) {
      return NextResponse.json(
        { error: "Missing required fields: src, dst, amount, from" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ZEROX_API_KEY;
    if (!apiKey) {
      console.log("[swap] No 0x API key - returning mock swap data");
      // Return mock data for development
      return NextResponse.json({
        success: true,
        mock: true,
        tx: {
          from,
          to: "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x Exchange Proxy
          data: "0x...", // Would be real calldata
          value:
            src.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
              ? amount
              : "0",
          gas: "300000",
          gasPrice: "1000000000",
        },
        srcAmount: amount,
        dstAmount: "1000000000000000000", // Mock 1 ETH worth
      });
    }

    // Build 0x swap URL (quote with transaction data)
    const url = new URL(`${ZEROX_API_BASE}/allowance-holder/quote`);
    url.searchParams.set("chainId", chainId.toString());
    url.searchParams.set("sellToken", src);
    url.searchParams.set("buyToken", dst);
    url.searchParams.set("sellAmount", amount);
    url.searchParams.set("taker", from);
    // Convert percentage slippage to bps (1% = 100 bps)
    const slippageBps = slippage ? Math.round(slippage * 100) : 100;
    url.searchParams.set("slippageBps", slippageBps.toString());

    console.log("[swap] Calling 0x API:", url.toString());
    const fetchStart = Date.now();

    const response = await fetch(url.toString(), {
      headers: {
        "0x-api-key": apiKey,
        "0x-version": "v2",
        Accept: "application/json",
      },
    });

    console.log(
      `[swap] 0x responded in ${Date.now() - fetchStart}ms, status: ${
        response.status
      }`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.log("[swap] 0x error:", errorData);
      return NextResponse.json(
        {
          error: `0x API error: ${response.status} - ${
            errorData.reason || response.statusText
          }`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log("[swap] 0x response:", JSON.stringify(data, null, 2));
    console.log(`[swap] Complete in ${Date.now() - startTime}ms`);

    // Extract protocol names from route
    const protocols =
      data.route?.fills
        ?.map((fill: { source: string }) => fill.source)
        ?.filter(
          (source: string, index: number, arr: string[]) =>
            arr.indexOf(source) === index
        ) || [];

    return NextResponse.json({
      success: true,
      tx: data.transaction,
      srcAmount: data.sellAmount,
      dstAmount: data.buyAmount,
      protocols,
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
  const chainId = searchParams.get("chainId") || "8453";

  console.log("[quote] Request:", { src, dst, amount, chainId });

  if (!src || !dst || !amount) {
    return NextResponse.json(
      { error: "Missing required params: src, dst, amount" },
      { status: 400 }
    );
  }

  const apiKey = process.env.ZEROX_API_KEY;
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
    const url = new URL(`${ZEROX_API_BASE}/allowance-holder/price`);
    url.searchParams.set("chainId", chainId);
    url.searchParams.set("sellToken", src);
    url.searchParams.set("buyToken", dst);
    url.searchParams.set("sellAmount", amount);

    console.log("[quote GET] Calling 0x API:", url.toString());
    const fetchStart = Date.now();

    const response = await fetch(url.toString(), {
      headers: {
        "0x-api-key": apiKey,
        "0x-version": "v2",
        Accept: "application/json",
      },
    });

    console.log(
      `[quote GET] 0x responded in ${Date.now() - fetchStart}ms, status: ${
        response.status
      }`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.log("[quote GET] 0x error:", errorData);
      return NextResponse.json(
        {
          error: `0x API error: ${response.status} - ${
            errorData.reason || response.statusText
          }`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log("[quote GET] 0x response:", JSON.stringify(data, null, 2));

    // Extract protocol names from route
    const protocols =
      data.route?.fills
        ?.map((fill: { source: string }) => fill.source)
        ?.filter(
          (source: string, index: number, arr: string[]) =>
            arr.indexOf(source) === index
        ) || [];

    return NextResponse.json({
      success: true,
      srcAmount: data.sellAmount,
      dstAmount: data.buyAmount,
      gas: data.gas,
      protocols,
    });
  } catch (error) {
    console.log("[quote GET] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
