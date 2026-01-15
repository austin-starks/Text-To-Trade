import { TokenInfo, QuoteResult } from "../types/order";
import { formatTokenAmount } from "./tokens";
import { SupportedChainId } from "../config";

const INCH_API_BASE = "https://api.1inch.dev/swap/v6.0";

interface InchQuoteResponse {
  srcToken: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI: string;
  };
  dstToken: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
    logoURI: string;
  };
  srcAmount: string;
  dstAmount: string;
  protocols: Array<Array<Array<{ name: string }>>>;
  gas: number;
}

export class InchApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = "InchApiError";
  }
}

export async function getQuote(
  sellToken: TokenInfo,
  buyToken: TokenInfo,
  sellAmount: string, // In wei/smallest unit
  apiKey: string,
  chainId: SupportedChainId
): Promise<QuoteResult> {
  const url = new URL(`${INCH_API_BASE}/${chainId}/quote`);
  url.searchParams.set("src", sellToken.address);
  url.searchParams.set("dst", buyToken.address);
  url.searchParams.set("amount", sellAmount);

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new InchApiError(
      `1inch API error: ${errorText}`,
      response.status
    );
  }

  const data: InchQuoteResponse = await response.json();

  // Extract protocol names from nested structure
  const protocols = data.protocols
    .flat(2)
    .map((p) => p.name)
    .filter((name, index, arr) => arr.indexOf(name) === index);

  return {
    sellToken: {
      symbol: data.srcToken.symbol,
      name: data.srcToken.name,
      address: data.srcToken.address,
      decimals: data.srcToken.decimals,
      logoUrl: data.srcToken.logoURI,
    },
    buyToken: {
      symbol: data.dstToken.symbol,
      name: data.dstToken.name,
      address: data.dstToken.address,
      decimals: data.dstToken.decimals,
      logoUrl: data.dstToken.logoURI,
    },
    sellAmount: data.srcAmount,
    buyAmount: data.dstAmount,
    sellAmountDisplay: formatTokenAmount(data.srcAmount, data.srcToken.decimals),
    buyAmountDisplay: formatTokenAmount(data.dstAmount, data.dstToken.decimals),
    estimatedGas: data.gas.toString(),
    protocols,
  };
}

// Mock quote for development without API key
export function getMockQuote(
  sellToken: TokenInfo,
  buyToken: TokenInfo,
  sellAmount: string,
  chainId: SupportedChainId
): QuoteResult {
  // Simulate some realistic-ish prices
  const mockPrices: Record<string, number> = {
    ETH: 3200,
    WETH: 3200,
    USDC: 1,
    USDT: 1,
    DAI: 1,
    DEGEN: 0.008,
    BRETT: 0.12,
    AERO: 1.2,
    cbBTC: 95000,
    VIRTUAL: 2.5,
    TOSHI: 0.0003,
  };

  const sellPrice = mockPrices[sellToken.symbol] || 1;
  const buyPrice = mockPrices[buyToken.symbol] || 1;

  const sellAmountNum =
    Number(sellAmount) / Math.pow(10, sellToken.decimals);
  const buyAmountNum = (sellAmountNum * sellPrice) / buyPrice;
  const buyAmountWei = Math.floor(
    buyAmountNum * Math.pow(10, buyToken.decimals)
  ).toString();

  return {
    sellToken,
    buyToken,
    sellAmount,
    buyAmount: buyAmountWei,
    sellAmountDisplay: formatTokenAmount(sellAmount, sellToken.decimals),
    buyAmountDisplay: formatTokenAmount(buyAmountWei, buyToken.decimals),
    estimatedGas: "150000",
    protocols: ["Uniswap V3", "Aerodrome"],
  };
}

