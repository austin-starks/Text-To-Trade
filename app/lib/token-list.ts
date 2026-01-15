import { TokenInfo } from "../types/order";

const BASE_CHAIN_ID = 8453;

// Public 1inch token list (no API key required!)
const PUBLIC_TOKEN_LIST_URL = `https://tokens.1inch.io/v1.2/${BASE_CHAIN_ID}`;

// In-memory cache
let cachedTokens: Record<string, TokenInfo> | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes (public list updates infrequently)

// Native ETH special address (1inch convention)
const NATIVE_ETH_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

// Fallback tokens if API fails (minimal set to keep app working)
const FALLBACK_TOKENS: Record<string, TokenInfo> = {
  ETH: {
    symbol: "ETH",
    name: "Ethereum",
    address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
    decimals: 18,
    logoUrl: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png",
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    logoUrl: "https://tokens.1inch.io/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.png",
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0x4200000000000000000000000000000000000006",
    decimals: 18,
    logoUrl: "https://tokens.1inch.io/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.png",
  },
};

interface OneInchToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoURI?: string;
}

interface OneInchTokenResponse {
  tokens: Record<string, OneInchToken>;
}

async function fetchTokensFromApi(): Promise<Record<string, TokenInfo>> {
  try {
    // Use public 1inch token list (no API key needed!)
    const response = await fetch(PUBLIC_TOKEN_LIST_URL, {
      headers: {
        Accept: "application/json",
      },
      // Cache at fetch level
      next: { revalidate: 600 },
    });

    if (!response.ok) {
      console.warn(`[token-list] Public token list error: ${response.status}`);
      return FALLBACK_TOKENS;
    }

    const data = await response.json() as Record<string, OneInchToken>;
    const tokens: Record<string, TokenInfo> = {};

    // Add native ETH first
    tokens["ETH"] = {
      symbol: "ETH",
      name: "Ethereum",
      address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
      decimals: 18,
      logoUrl: "https://tokens.1inch.io/0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.png",
    };

    // Convert 1inch format to our format
    for (const [address, token] of Object.entries(data)) {
      // Skip native ETH duplicate (sometimes returned as 0xeee...)
      if (address.toLowerCase() === NATIVE_ETH_ADDRESS) continue;
      
      const symbol = token.symbol.toUpperCase();
      tokens[symbol] = {
        symbol: token.symbol,
        name: token.name,
        address: token.address || address,
        decimals: token.decimals,
        logoUrl: token.logoURI || `https://tokens.1inch.io/${address.toLowerCase()}.png`,
      };
    }

    return tokens;
  } catch (error) {
    console.warn("[token-list] Failed to fetch token list:", error);
    return FALLBACK_TOKENS;
  }
}

/**
 * Get all supported tokens (cached)
 */
export async function getTokenList(): Promise<Record<string, TokenInfo>> {
  const now = Date.now();
  
  // Return cached if still valid
  if (cachedTokens && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedTokens;
  }

  // Fetch fresh data
  cachedTokens = await fetchTokensFromApi();
  cacheTimestamp = now;
  
  return cachedTokens;
}

/**
 * Get token symbols list (for LLM prompt)
 */
export async function getTokenSymbolsList(): Promise<string[]> {
  const tokens = await getTokenList();
  return Object.keys(tokens);
}

/**
 * Resolve a token by symbol (async version)
 */
export async function resolveTokenAsync(symbol: string): Promise<TokenInfo | null> {
  const tokens = await getTokenList();
  const normalized = symbol.toUpperCase().trim();
  
  // Direct match
  if (tokens[normalized]) {
    return tokens[normalized];
  }

  // Common aliases
  const aliases: Record<string, string> = {
    ETHEREUM: "ETH",
    ETHER: "ETH",
    BITCOIN: "WBTC",
    BTC: "WBTC",
    "USD COIN": "USDC",
    TETHER: "USDT",
    STABLES: "USDC",
    STABLE: "USDC",
  };

  const aliasKey = aliases[normalized];
  if (aliasKey && tokens[aliasKey]) {
    return tokens[aliasKey];
  }

  return null;
}

/**
 * Force refresh the cache
 */
export async function refreshTokenCache(): Promise<void> {
  cachedTokens = await fetchTokensFromApi();
  cacheTimestamp = Date.now();
}

/**
 * Get popular/featured tokens for UI display
 */
export async function getPopularTokens(): Promise<TokenInfo[]> {
  const tokens = await getTokenList();
  
  // Prioritized list of popular tokens on Base
  const popular = [
    "ETH", "USDC", "WETH", "USDT", "DAI", 
    "DEGEN", "BRETT", "AERO", "cbBTC", "VIRTUAL", "TOSHI"
  ];
  
  return popular
    .filter(symbol => tokens[symbol])
    .map(symbol => tokens[symbol]);
}

