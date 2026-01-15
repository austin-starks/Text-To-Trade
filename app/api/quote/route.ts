import { NextRequest, NextResponse } from "next/server";

const ZEROX_API_BASE = "https://api.0x.org/swap";

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  console.log("[quote] Request started");

  try {
    const {
      sellTokenAddress,
      buyTokenAddress,
      amount,
      chainId = 8453,
    } = await request.json();

    console.log("[quote] Request params:", {
      sellTokenAddress,
      buyTokenAddress,
      amount,
      chainId,
    });

    if (!sellTokenAddress || !buyTokenAddress || !amount) {
      return NextResponse.json(
        {
          error:
            "Missing required parameters: sellTokenAddress, buyTokenAddress, amount",
        },
        { status: 400 }
      );
    }

    const apiKey = process.env.ZEROX_API_KEY;
    if (!apiKey) {
      console.log("[quote] No 0x API key configured");
      return NextResponse.json(
        { error: "0x API key not configured. Using mock quotes." },
        { status: 501 }
      );
    }

    const url = new URL(`${ZEROX_API_BASE}/allowance-holder/price`);
    url.searchParams.set("chainId", chainId.toString());
    url.searchParams.set("sellToken", sellTokenAddress);
    url.searchParams.set("buyToken", buyTokenAddress);
    url.searchParams.set("sellAmount", amount);

    console.log("[quote] Calling 0x API:", url.toString());
    const fetchStart = Date.now();

    const response = await fetch(url.toString(), {
      headers: {
        "0x-api-key": apiKey,
        "0x-version": "v2",
        Accept: "application/json",
      },
    });

    console.log(
      `[quote] 0x responded in ${Date.now() - fetchStart}ms, status: ${
        response.status
      }`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.log("[quote] 0x error:", errorData);
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
    console.log("[quote] 0x response:", JSON.stringify(data, null, 2));
    console.log(`[quote] Complete in ${Date.now() - startTime}ms`);

    return NextResponse.json({ success: true, quote: data });
  } catch (error) {
    console.log("[quote] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
