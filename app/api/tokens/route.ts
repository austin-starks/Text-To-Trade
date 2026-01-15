import { NextResponse } from "next/server";
import { getTokenList, getPopularTokens } from "../../lib/token-list";

export async function GET() {
  try {
    const [allTokens, popularTokens] = await Promise.all([
      getTokenList(),
      getPopularTokens(),
    ]);

    return NextResponse.json({
      success: true,
      tokens: allTokens,
      popular: popularTokens,
      count: Object.keys(allTokens).length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch tokens" },
      { status: 500 }
    );
  }
}

