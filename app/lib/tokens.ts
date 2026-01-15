import { TokenInfo } from "../types/order";

// Native ETH represented as special address
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// Popular tokens on Base mainnet
export const BASE_TOKENS: Record<string, TokenInfo> = {
  ETH: {
    symbol: "ETH",
    name: "Ethereum",
    address: NATIVE_ETH,
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ether",
    address: "0x4200000000000000000000000000000000000006",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/2518/small/weth.png",
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
    logoUrl: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    decimals: 6,
    logoUrl: "https://assets.coingecko.com/coins/images/325/small/Tether.png",
  },
  DAI: {
    symbol: "DAI",
    name: "Dai Stablecoin",
    address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png",
  },
  DEGEN: {
    symbol: "DEGEN",
    name: "Degen",
    address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/34515/small/android-chrome-512x512.png",
  },
  BRETT: {
    symbol: "BRETT",
    name: "Brett",
    address: "0x532f27101965dd16442E59d40670FaF5eBB142E4",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/35529/small/1000050750.png",
  },
  AERO: {
    symbol: "AERO",
    name: "Aerodrome Finance",
    address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/31745/small/token.png",
  },
  cbBTC: {
    symbol: "cbBTC",
    name: "Coinbase Wrapped BTC",
    address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals: 8,
    logoUrl: "https://assets.coingecko.com/coins/images/40143/standard/cbbtc.webp",
  },
  VIRTUAL: {
    symbol: "VIRTUAL",
    name: "Virtual Protocol",
    address: "0x0b3e328455c4059EEb9e3f84b5543F74E24e7E1b",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/36082/standard/virtual.jpeg",
  },
  TOSHI: {
    symbol: "TOSHI",
    name: "Toshi",
    address: "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4",
    decimals: 18,
    logoUrl: "https://assets.coingecko.com/coins/images/31126/small/toshi.png",
  },
};

// Create aliases for common variations
const TOKEN_ALIASES: Record<string, string> = {
  ETHEREUM: "ETH",
  ETHER: "ETH",
  "WRAPPED ETH": "WETH",
  "WRAPPED ETHER": "WETH",
  "USD COIN": "USDC",
  TETHER: "USDT",
  BITCOIN: "cbBTC",
  BTC: "cbBTC",
  WRAPPED_BTC: "cbBTC",
};

export function resolveToken(input: string): TokenInfo | null {
  const normalized = input.toUpperCase().trim();

  // Direct match
  if (BASE_TOKENS[normalized]) {
    return BASE_TOKENS[normalized];
  }

  // Check aliases
  const aliasKey = TOKEN_ALIASES[normalized];
  if (aliasKey && BASE_TOKENS[aliasKey]) {
    return BASE_TOKENS[aliasKey];
  }

  return null;
}

export function getAllTokens(): TokenInfo[] {
  return Object.values(BASE_TOKENS);
}

export function formatTokenAmount(
  amount: string,
  decimals: number
): string {
  const num = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const whole = num / divisor;
  const remainder = num % divisor;

  if (remainder === BigInt(0)) {
    return whole.toString();
  }

  const remainderStr = remainder.toString().padStart(decimals, "0");
  const trimmed = remainderStr.replace(/0+$/, "");

  return `${whole}.${trimmed}`;
}

export function parseTokenAmount(
  amount: string,
  decimals: number
): string {
  const [whole, fraction = ""] = amount.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const combined = whole + paddedFraction;
  return BigInt(combined).toString();
}

