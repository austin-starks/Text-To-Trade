import { ParsedOrder } from "../types/order";
import { resolveToken } from "./tokens";

// Common patterns for parsing trade commands
const SWAP_PATTERNS = [
  // "swap 100 USDC for ETH" or "swap 100 USDC to ETH"
  /swap\s+([\d.]+)\s+(\w+)\s+(?:for|to|into)\s+(\w+)/i,
  // "swap USDC for ETH" (no amount)
  /swap\s+(\w+)\s+(?:for|to|into)\s+(\w+)/i,
];

const BUY_PATTERNS = [
  // "buy 0.1 ETH with USDC" or "buy 0.1 ETH using USDC"
  /buy\s+([\d.]+)\s+(\w+)\s+(?:with|using|for)\s+([\d.]+)?\s*(\w+)/i,
  // "buy 0.1 ETH" (assumes USDC)
  /buy\s+([\d.]+)\s+(\w+)/i,
  // "buy ETH with 100 USDC"
  /buy\s+(\w+)\s+(?:with|using|for)\s+([\d.]+)\s+(\w+)/i,
];

const SELL_PATTERNS = [
  // "sell 100 USDC for ETH"
  /sell\s+([\d.]+)\s+(\w+)\s+(?:for|to|into)\s+(\w+)/i,
  // "sell 0.1 ETH" (assumes for USDC)
  /sell\s+([\d.]+)\s+(\w+)/i,
];

const CONVERT_PATTERNS = [
  // "convert 100 USDC to ETH"
  /convert\s+([\d.]+)\s+(\w+)\s+(?:to|into)\s+(\w+)/i,
  // "100 USDC to ETH" or "100 USDC -> ETH"
  /([\d.]+)\s+(\w+)\s+(?:to|->|=>|into)\s+(\w+)/i,
];

export interface ParseResult {
  success: boolean;
  order?: ParsedOrder;
  error?: string;
  suggestions?: string[];
}

export function parseOrderInput(input: string): ParseResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return {
      success: false,
      error: "Please enter a trade command",
      suggestions: [
        "swap 100 USDC for ETH",
        "buy 0.05 ETH with USDC",
        "sell 1000 DEGEN for USDC",
      ],
    };
  }

  // Try swap patterns
  for (const pattern of SWAP_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      if (match.length === 4) {
        // Has amount: swap 100 USDC for ETH
        const [, amount, sellSymbol, buySymbol] = match;
        return validateAndBuildOrder("swap", sellSymbol, buySymbol, amount, undefined, trimmed);
      } else if (match.length === 3) {
        // No amount: swap USDC for ETH
        const [, sellSymbol, buySymbol] = match;
        return {
          success: false,
          error: `Please specify an amount to swap`,
          suggestions: [`swap 100 ${sellSymbol} for ${buySymbol}`],
        };
      }
    }
  }

  // Try buy patterns
  for (const pattern of BUY_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      // "buy 0.1 ETH with 100 USDC"
      if (match.length === 5 && match[3]) {
        const [, buyAmount, buySymbol, sellAmount, sellSymbol] = match;
        return validateAndBuildOrder("buy", sellSymbol, buySymbol, sellAmount, buyAmount, trimmed);
      }
      // "buy 0.1 ETH" - assume USDC
      if (match.length === 3) {
        const [, buyAmount, buySymbol] = match;
        return validateAndBuildOrder("buy", "USDC", buySymbol, undefined, buyAmount, trimmed);
      }
      // "buy ETH with 100 USDC"
      if (match.length === 4) {
        const [, buySymbol, sellAmount, sellSymbol] = match;
        return validateAndBuildOrder("buy", sellSymbol, buySymbol, sellAmount, undefined, trimmed);
      }
    }
  }

  // Try sell patterns
  for (const pattern of SELL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      if (match.length === 4) {
        // "sell 100 USDC for ETH"
        const [, amount, sellSymbol, buySymbol] = match;
        return validateAndBuildOrder("sell", sellSymbol, buySymbol, amount, undefined, trimmed);
      } else if (match.length === 3) {
        // "sell 0.1 ETH" - assume for USDC
        const [, amount, sellSymbol] = match;
        return validateAndBuildOrder("sell", sellSymbol, "USDC", amount, undefined, trimmed);
      }
    }
  }

  // Try convert patterns
  for (const pattern of CONVERT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      const [, amount, sellSymbol, buySymbol] = match;
      return validateAndBuildOrder("swap", sellSymbol, buySymbol, amount, undefined, trimmed);
    }
  }

  // No pattern matched
  return {
    success: false,
    error: "I couldn't understand that trade command",
    suggestions: [
      "swap 100 USDC for ETH",
      "buy 0.05 ETH with USDC",
      "sell 1000 DEGEN for USDC",
      "100 USDC to ETH",
    ],
  };
}

function validateAndBuildOrder(
  action: "swap" | "buy" | "sell",
  sellSymbol: string,
  buySymbol: string,
  sellAmount: string | undefined,
  buyAmount: string | undefined,
  rawInput: string
): ParseResult {
  const sellToken = resolveToken(sellSymbol);
  const buyToken = resolveToken(buySymbol);

  if (!sellToken) {
    return {
      success: false,
      error: `Unknown token: ${sellSymbol}`,
      suggestions: [
        "Supported tokens: ETH, USDC, USDT, DAI, DEGEN, BRETT, AERO, cbBTC, VIRTUAL, TOSHI",
      ],
    };
  }

  if (!buyToken) {
    return {
      success: false,
      error: `Unknown token: ${buySymbol}`,
      suggestions: [
        "Supported tokens: ETH, USDC, USDT, DAI, DEGEN, BRETT, AERO, cbBTC, VIRTUAL, TOSHI",
      ],
    };
  }

  if (sellToken.symbol === buyToken.symbol) {
    return {
      success: false,
      error: "Cannot swap a token for itself",
    };
  }

  // Validate amounts are positive numbers
  if (sellAmount && (isNaN(Number(sellAmount)) || Number(sellAmount) <= 0)) {
    return {
      success: false,
      error: "Please enter a valid positive amount",
    };
  }

  if (buyAmount && (isNaN(Number(buyAmount)) || Number(buyAmount) <= 0)) {
    return {
      success: false,
      error: "Please enter a valid positive amount",
    };
  }

  return {
    success: true,
    order: {
      action,
      sellToken: sellToken.symbol,
      buyToken: buyToken.symbol,
      sellAmount,
      buyAmount,
      rawInput,
    },
  };
}

