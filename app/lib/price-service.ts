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
 */
async function fetchPricesFromAPI(): Promise<Record<string, number>> {
  try {
    const response = await fetch("/api/prices");
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
  
  clientPriceCache = { prices, fetchedAt: now };
  
  return prices;
}

/**
 * Get current price for a token
 */
export async function getTokenPrice(symbol: string): Promise<number | null> {
  const prices = await getPriceCache();
  const price = prices[symbol.toUpperCase()];
  
  if (price === undefined) {
    console.warn(`No price available for ${symbol}`);
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

// Export for strategy executor
export const priceService = {
  getPrice: getTokenPrice,
  getAllPrices,
  isTokenSupportedForPrices: isTokenSupported,
  refresh: refreshPrices,
};
