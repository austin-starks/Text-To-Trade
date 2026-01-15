// API route to fetch real-time prices from 1inch
// This runs server-side so it has access to ONEINCH_API_KEY

import { NextRequest, NextResponse } from "next/server";
import { getTokenList } from "../../lib/token-list";

const INCH_PRICE_API = "https://api.1inch.dev/price/v1.1";
const BASE_CHAIN_ID = 8453;

// Server-side cache (short TTL for responsive polling)
let priceCache: { prices: Record<string, number>; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 1000; // 5 seconds to support responsive polling

export async function GET(request: NextRequest) {
  try {
    const now = Date.now();
    
    // Return cached prices if still valid
    if (priceCache && (now - priceCache.fetchedAt < CACHE_TTL_MS)) {
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
    
    // Build address -> symbol map
    const addressToSymbol: Record<string, string> = {};
    const addresses: string[] = [];
    
    for (const [symbol, token] of Object.entries(tokenList)) {
      if (token.address) {
        addressToSymbol[token.address.toLowerCase()] = symbol;
        addresses.push(token.address);
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
        tokens: addresses.slice(0, 50), // Limit to 50 tokens
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
    
    // Convert addresses to symbols
    const prices: Record<string, number> = {};
    
    for (const [address, price] of Object.entries(data)) {
      const symbol = addressToSymbol[address.toLowerCase()];
      if (symbol && typeof price === "string") {
        prices[symbol] = parseFloat(price);
      }
    }

    // Update cache
    priceCache = { prices, fetchedAt: now };

    return NextResponse.json({ 
      success: true, 
      prices,
      cached: false,
      tokenCount: Object.keys(prices).length
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

