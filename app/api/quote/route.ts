import { NextRequest, NextResponse } from "next/server";

const BASE_CHAIN_ID = 8453;
const INCH_API_BASE = "https://api.1inch.dev/swap/v6.0";

export async function POST(request: NextRequest) {
  try {
    const { sellTokenAddress, buyTokenAddress, amount } = await request.json();

    if (!sellTokenAddress || !buyTokenAddress || !amount) {
      return NextResponse.json(
        { error: "Missing required parameters: sellTokenAddress, buyTokenAddress, amount" },
        { status: 400 }
      );
    }

    const apiKey = process.env.ONEINCH_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "1inch API key not configured. Using mock quotes." },
        { status: 501 }
      );
    }

    const url = new URL(`${INCH_API_BASE}/${BASE_CHAIN_ID}/quote`);
    url.searchParams.set("src", sellTokenAddress);
    url.searchParams.set("dst", buyTokenAddress);
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
    return NextResponse.json({ success: true, quote: data });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
