// API route to fetch real-time prices from 1inch
// This runs server-side so it has access to ONEINCH_API_KEY

import { NextRequest, NextResponse } from "next/server";
import { getTokenList } from "../../lib/token-list";

const INCH_PRICE_API = "https://api.1inch.dev/price/v1.1";
const BASE_CHAIN_ID = 8453;

// Priority tokens that should always be fetched (popular/important tokens)
const PRIORITY_TOKENS = [
  "ETH", "WETH", "USDC", "USDT", "DAI", "WBTC", "cbBTC", "cbETH",
  "AERO", "DEGEN", "BRETT", "VIRTUAL", "HIGHER", "TOSHI", "MOG"
];

// Server-side cache (short TTL for responsive polling)
let priceCache: { prices: Record<string, number>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 1000; // 5 seconds to support responsive polling

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();
    const { searchParams } = new URL(request.url);
    
    // Allow requesting specific tokens via query param
    const requestedTokens = searchParams.get("tokens")?.split(",").map(t => t.trim().toUpperCase()) || [];
    
    // Return cached prices if still valid (and no specific tokens requested)
    if (requestedTokens.length === 0 && priceCache && (now - priceCache.fetchedAt < CACHE_TTL_MS)) {
      return NextResponse.json({ 
        success: true, 
        prices: priceCache.prices,
        cached: true,
        cacheAge: now - priceCache.fetchedAt
      });
    }

    const apiKey = process.env.ONEINCH_API_KEY;
    
    if (!apiKey) {
      console.error("ONEINCH_API_KEY not configured");
      return NextResponse.json({ 
        success: false, 
        error: "Price API not configured",
        prices: {} 
      }, { status: 500 });
    }

    // Get token list from 1inch (includes addresses)
    const tokenList = await getTokenList();
    
    // Build symbol -> address map and address -> symbol map
    const symbolToAddress: Record<string, string> = {};
    const addressToSymbol: Record<string, string> = {};
    
    for (const [symbol, token] of Object.entries(tokenList)) {
      if (token.address) {
        const upperSymbol = symbol.toUpperCase();
        symbolToAddress[upperSymbol] = token.address;
        addressToSymbol[token.address.toLowerCase()] = upperSymbol;
      }
    }

    // Build list of addresses to fetch
    // 1. Start with priority tokens
    // 2. Add any specifically requested tokens
    // 3. Fill remaining slots with other tokens
    const addressesToFetch: string[] = [];
    const addedSymbols = new Set<string>();
    
    // Add priority tokens first
    for (const symbol of PRIORITY_TOKENS) {
      const addr = symbolToAddress[symbol.toUpperCase()];
      if (addr && !addedSymbols.has(symbol.toUpperCase())) {
        addressesToFetch.push(addr);
        addedSymbols.add(symbol.toUpperCase());
      }
    }
    
    // Add requested tokens
    for (const symbol of requestedTokens) {
      const addr = symbolToAddress[symbol];
      if (addr && !addedSymbols.has(symbol)) {
        addressesToFetch.push(addr);
        addedSymbols.add(symbol);
      }
    }
    
    // Fill remaining with other tokens (up to 50 total)
    for (const [symbol, addr] of Object.entries(symbolToAddress)) {
      if (addressesToFetch.length >= 50) break;
      if (!addedSymbols.has(symbol)) {
        addressesToFetch.push(addr);
        addedSymbols.add(symbol);
      }
    }

    // 1inch spot price endpoint
    const url = `${INCH_PRICE_API}/${BASE_CHAIN_ID}`;
    
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        tokens: addressesToFetch,
        currency: "USD",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`1inch Price API error: ${response.status} - ${errorText}`);
      return NextResponse.json({ 
        success: false, 
        error: `Price API error: ${response.status}`,
        prices: priceCache?.prices || {} // Return stale cache if available
      }, { status: 502 });
    }

    const data = await response.json();
    
    // Convert addresses to symbols (uppercase)
    const prices: Record<string, number> = {};
    
    for (const [address, price] of Object.entries(data)) {
      const symbol = addressToSymbol[address.toLowerCase()];
      if (symbol && typeof price === "string") {
        prices[symbol] = parseFloat(price);
      }
    }

    // Update cache (merge with existing if we only requested specific tokens)
    if (requestedTokens.length === 0) {
      priceCache = { prices, fetchedAt: now };
    } else if (priceCache) {
      priceCache = { 
        prices: { ...priceCache.prices, ...prices }, 
        fetchedAt: now 
      };
    } else {
      priceCache = { prices, fetchedAt: now };
    }

    return NextResponse.json({ 
      success: true, 
      prices: priceCache.prices,
      cached: false,
      tokenCount: Object.keys(priceCache.prices).length
    });

  } catch (error) {
    console.error("Error fetching prices:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Failed to fetch prices",
      prices: priceCache?.prices || {}
    }, { status: 500 });
  }
}

