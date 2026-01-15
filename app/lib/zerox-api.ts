import { TokenInfo, QuoteResult } from "../types/order";
import { formatTokenAmount } from "./tokens";
import { SupportedChainId } from "../config";

const ZEROX_API_BASE = "https://api.0x.org/swap";

interface ZeroXTokenMetadata {
  buyToken: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
  sellToken: {
    address: string;
    symbol: string;
    name: string;
    decimals: number;
  };
}

interface ZeroXFill {
  from: string;
  to: string;
  source: string;
  proportionBps: string;
}

interface ZeroXRoute {
  fills: ZeroXFill[];
  tokens: Array<{
    address: string;
    symbol: string;
  }>;
}

interface ZeroXPriceResponse {
  blockNumber: string;
  buyAmount: string;
  buyToken: string;
  sellAmount: string;
  sellToken: string;
  gas: string;
  gasPrice: string;
  liquidityAvailable: boolean;
  minBuyAmount: string;
  route: ZeroXRoute;
  tokenMetadata: ZeroXTokenMetadata;
  totalNetworkFee: string;
  zid: string;
}

export class ZeroXApiError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public code?: string
  ) {
    super(message);
    this.name = "ZeroXApiError";
  }
}

/**
 * Get an indicative price quote from 0x Swap API
 * This is useful for displaying estimated prices without requiring a taker address
 */
export async function getPrice(
  sellToken: TokenInfo,
  buyToken: TokenInfo,
  sellAmount: string, // In wei/smallest unit
  apiKey: string,
  chainId: SupportedChainId
): Promise<QuoteResult> {
  const url = new URL(`${ZEROX_API_BASE}/allowance-holder/price`);
  url.searchParams.set("chainId", chainId.toString());
  url.searchParams.set("sellToken", sellToken.address);
  url.searchParams.set("buyToken", buyToken.address);
  url.searchParams.set("sellAmount", sellAmount);

  const response = await fetch(url.toString(), {
    headers: {
      "0x-api-key": apiKey,
      "0x-version": "v2",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ZeroXApiError(
      errorData.reason || `0x API error: ${response.statusText}`,
      response.status,
      errorData.code
    );
  }

  const data: ZeroXPriceResponse = await response.json();

  if (!data.liquidityAvailable) {
    throw new ZeroXApiError("No liquidity available for this swap", 422);
  }

  // Extract unique protocol/source names from the route
  const protocols = data.route.fills
    .map((fill) => fill.source)
    .filter((source, index, arr) => arr.indexOf(source) === index);

  return {
    sellToken: {
      symbol: data.tokenMetadata.sellToken.symbol,
      name: data.tokenMetadata.sellToken.name,
      address: data.tokenMetadata.sellToken.address,
      decimals: data.tokenMetadata.sellToken.decimals,
    },
    buyToken: {
      symbol: data.tokenMetadata.buyToken.symbol,
      name: data.tokenMetadata.buyToken.name,
      address: data.tokenMetadata.buyToken.address,
      decimals: data.tokenMetadata.buyToken.decimals,
    },
    sellAmount: data.sellAmount,
    buyAmount: data.buyAmount,
    sellAmountDisplay: formatTokenAmount(
      data.sellAmount,
      data.tokenMetadata.sellToken.decimals
    ),
    buyAmountDisplay: formatTokenAmount(
      data.buyAmount,
      data.tokenMetadata.buyToken.decimals
    ),
    estimatedGas: data.gas,
    protocols,
  };
}

interface ZeroXQuoteResponse extends ZeroXPriceResponse {
  transaction: {
    to: string;
    data: string;
    value: string;
    gas: string;
    gasPrice: string;
  };
  permit2?: {
    type: string;
    hash: string;
    eip712: object;
  };
}

/**
 * Get a firm quote with transaction data from 0x Swap API
 * This requires a taker address and returns executable transaction data
 */
export async function getQuote(
  sellToken: TokenInfo,
  buyToken: TokenInfo,
  sellAmount: string, // In wei/smallest unit
  takerAddress: string,
  apiKey: string,
  chainId: SupportedChainId,
  slippageBps: number = 100 // Default 1% slippage
): Promise<QuoteResult & { transaction?: ZeroXQuoteResponse["transaction"] }> {
  const url = new URL(`${ZEROX_API_BASE}/allowance-holder/quote`);
  url.searchParams.set("chainId", chainId.toString());
  url.searchParams.set("sellToken", sellToken.address);
  url.searchParams.set("buyToken", buyToken.address);
  url.searchParams.set("sellAmount", sellAmount);
  url.searchParams.set("taker", takerAddress);
  url.searchParams.set("slippageBps", slippageBps.toString());

  const response = await fetch(url.toString(), {
    headers: {
      "0x-api-key": apiKey,
      "0x-version": "v2",
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new ZeroXApiError(
      errorData.reason || `0x API error: ${response.statusText}`,
      response.status,
      errorData.code
    );
  }

  const data: ZeroXQuoteResponse = await response.json();

  if (!data.liquidityAvailable) {
    throw new ZeroXApiError("No liquidity available for this swap", 422);
  }

  // Extract unique protocol/source names from the route
  const protocols = data.route.fills
    .map((fill) => fill.source)
    .filter((source, index, arr) => arr.indexOf(source) === index);

  return {
    sellToken: {
      symbol: data.tokenMetadata.sellToken.symbol,
      name: data.tokenMetadata.sellToken.name,
      address: data.tokenMetadata.sellToken.address,
      decimals: data.tokenMetadata.sellToken.decimals,
    },
    buyToken: {
      symbol: data.tokenMetadata.buyToken.symbol,
      name: data.tokenMetadata.buyToken.name,
      address: data.tokenMetadata.buyToken.address,
      decimals: data.tokenMetadata.buyToken.decimals,
    },
    sellAmount: data.sellAmount,
    buyAmount: data.buyAmount,
    sellAmountDisplay: formatTokenAmount(
      data.sellAmount,
      data.tokenMetadata.sellToken.decimals
    ),
    buyAmountDisplay: formatTokenAmount(
      data.buyAmount,
      data.tokenMetadata.buyToken.decimals
    ),
    estimatedGas: data.gas,
    protocols,
    transaction: data.transaction,
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
    protocols: ["Uniswap_V3", "SushiSwap"],
  };
}
