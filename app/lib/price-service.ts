// Client-side price service
// Fetches prices via API route (server-side handles 1inch API key)

// Client-side cache
interface PriceCache {
  prices: Record<string, number>;
  fetchedAt: number;
}

let clientPriceCache: PriceCache | null = null;
const CLIENT_CACHE_TTL_MS = 15 * 1000; // 15 seconds client-side

/**
 * Fetch prices from our API route
 * @param tokens Optional list of specific tokens to fetch prices for
 */
async function fetchPricesFromAPI(tokens?: string[]): Promise<Record<string, number>> {
  try {
    let url = "/api/prices";
    if (tokens && tokens.length > 0) {
      url += `?tokens=${tokens.join(",")}`;
    }
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (!data.success) {
      console.warn("Price API returned error:", data.error);
      return data.prices || {};
    }
    
    return data.prices;
  } catch (error) {
    console.error("Failed to fetch prices from API:", error);
    return clientPriceCache?.prices || {};
  }
}

/**
 * Get cached prices, fetching if needed
 */
async function getPriceCache(): Promise<Record<string, number>> {
  const now = Date.now();
  
  // Return cached if still valid
  if (clientPriceCache && (now - clientPriceCache.fetchedAt < CLIENT_CACHE_TTL_MS)) {
    return clientPriceCache.prices;
  }
  
  // Fetch fresh prices
  const prices = await fetchPricesFromAPI();
  
  // Log what we got
  const tokenCount = Object.keys(prices).length;
  if (tokenCount > 0) {
    console.log(`[Price] Fetched ${tokenCount} prices: ${Object.keys(prices).join(", ")}`);
  } else {
    console.warn("[Price] No prices returned from API!");
  }
  
  clientPriceCache = { prices, fetchedAt: now };
  
  return prices;
}

/**
 * Get current price for a token
 */
export async function getTokenPrice(symbol: string): Promise<number | null> {
  const prices = await getPriceCache();
  const upperSymbol = symbol.toUpperCase();
  
  // Try exact match first, then uppercase
  let price = prices[symbol] ?? prices[upperSymbol];
  
  // If still not found, try case-insensitive search
  if (price === undefined) {
    const matchingKey = Object.keys(prices).find(
      key => key.toUpperCase() === upperSymbol
    );
    if (matchingKey) {
      price = prices[matchingKey];
    }
  }
  
  if (price === undefined) {
    console.warn(`[Price] No price for "${symbol}" (tried: ${symbol}, ${upperSymbol})`);
    console.warn(`[Price] Available tokens: ${Object.keys(prices).slice(0, 20).join(", ")}${Object.keys(prices).length > 20 ? "..." : ""}`);
    return null;
  }
  
  return price;
}

/**
 * Get all cached prices
 */
export async function getAllPrices(): Promise<Record<string, number>> {
  return getPriceCache();
}

/**
 * Check if a token has price data available
 */
export async function isTokenSupported(symbol: string): Promise<boolean> {
  const prices = await getPriceCache();
  return symbol.toUpperCase() in prices;
}

// Alias for backward compatibility
export const isTokenSupportedForPrices = isTokenSupported;

/**
 * Force refresh prices (bypass cache)
 */
export async function refreshPrices(): Promise<Record<string, number>> {
  clientPriceCache = null;
  return getPriceCache();
}

/**
 * Prefetch prices for specific tokens (ensures they're in cache)
 * Use this before evaluating strategies to ensure all needed tokens are available
 */
export async function prefetchPrices(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  
  const upperTokens = tokens.map(t => t.toUpperCase());
  console.log(`[Price] Prefetching prices for: ${upperTokens.join(", ")}`);
  
  // Fetch prices for specific tokens (will merge with existing cache on server)
  const prices = await fetchPricesFromAPI(upperTokens);
  
  // Update local cache by merging
  if (clientPriceCache) {
    clientPriceCache = {
      prices: { ...clientPriceCache.prices, ...prices },
      fetchedAt: Date.now(),
    };
  } else {
    clientPriceCache = { prices, fetchedAt: Date.now() };
  }
}

// Export for strategy executor
export const priceService = {
  getPrice: getTokenPrice,
  getAllPrices,
  isTokenSupportedForPrices: isTokenSupported,
  refresh: refreshPrices,
  prefetch: prefetchPrices,
};
