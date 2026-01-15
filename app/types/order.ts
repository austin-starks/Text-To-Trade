export type OrderAction = "swap" | "buy" | "sell";

export interface ParsedOrder {
  action: OrderAction;
  sellToken: string; // Symbol like "USDC", "ETH"
  buyToken: string;
  sellAmount?: string; // Amount to sell (e.g., "100")
  buyAmount?: string; // Amount to buy (e.g., "0.05")
  rawInput: string; // Original user input
}

export interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoUrl?: string;
}

export interface QuoteResult {
  sellToken: TokenInfo;
  buyToken: TokenInfo;
  sellAmount: string; // In wei/smallest unit
  buyAmount: string; // In wei/smallest unit
  sellAmountDisplay: string; // Human readable
  buyAmountDisplay: string; // Human readable
  estimatedGas: string;
  protocols: string[]; // DEXes used
  priceImpact?: string;
}

export interface OrderState {
  status: "idle" | "parsing" | "quoting" | "quoted" | "error";
  parsedOrder: ParsedOrder | null;
  quote: QuoteResult | null;
  error: string | null;
}

