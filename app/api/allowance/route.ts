import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, erc20Abi } from "viem";
import { base } from "viem/chains";

const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const owner = searchParams.get("owner");
  const spender = searchParams.get("spender");

  if (!token || !owner || !spender) {
    return NextResponse.json(
      { error: "Missing required params: token, owner, spender" },
      { status: 400 }
    );
  }

  try {
    const allowance = await publicClient.readContract({
      address: token as `0x${string}`,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner as `0x${string}`, spender as `0x${string}`],
    });

    return NextResponse.json({
      success: true,
      allowance: allowance.toString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to check allowance" },
      { status: 500 }
    );
  }
}

