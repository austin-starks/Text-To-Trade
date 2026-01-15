"use client";

import { useAccount, useBalance, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { useEffect, useState, useCallback, useRef } from "react";

// ERC20 ABI for balanceOf
const erc20Abi = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export interface TokenBalance {
  symbol: string;
  balance: string; // Human-readable balance
  balanceRaw: string; // Raw wei/smallest unit
  decimals: number;
  usdValue?: number;
  price?: number;
}

export interface Portfolio {
  balances: TokenBalance[];
  totalUsdValue: number;
  prices: Record<string, number>;
  isLoading: boolean;
  error?: string;
  refetch: () => void;
}

interface TokenInfo {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logoUrl?: string;
}

// Native ETH address
const NATIVE_ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

// Polling intervals
const PRICE_POLL_INTERVAL = 5000; // 5 seconds for prices
const BALANCE_POLL_INTERVAL = 10000; // 10 seconds for balances

export function usePortfolio(): Portfolio {
  const { address, isConnected } = useAccount();
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(true);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [isLoadingPrices, setIsLoadingPrices] = useState(true);
  const priceIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch token list from API (once)
  useEffect(() => {
    async function fetchTokens() {
      try {
        const response = await fetch("/api/tokens");
        const data = await response.json();
        if (data.success && data.popular) {
          setTokens(data.popular);
        }
      } catch (error) {
        console.warn("Failed to fetch token list:", error);
      } finally {
        setIsLoadingTokens(false);
      }
    }
    fetchTokens();
  }, []);

  // Fetch prices function
  const fetchPrices = useCallback(async () => {
    try {
      const response = await fetch("/api/prices");
      const data = await response.json();
      if (data.success && data.prices) {
        setPrices(data.prices);
      }
    } catch (error) {
      console.warn("Failed to fetch prices:", error);
    } finally {
      setIsLoadingPrices(false);
    }
  }, []);

  // Poll prices every 5 seconds
  useEffect(() => {
    // Initial fetch
    fetchPrices();

    // Set up polling
    priceIntervalRef.current = setInterval(fetchPrices, PRICE_POLL_INTERVAL);

    return () => {
      if (priceIntervalRef.current) {
        clearInterval(priceIntervalRef.current);
      }
    };
  }, [fetchPrices]);

  // Fetch native ETH balance with polling
  const { data: ethBalance, isLoading: ethLoading, refetch: refetchEth } = useBalance({
    address,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: BALANCE_POLL_INTERVAL,
    },
  });

  // Get ERC20 tokens to check (exclude native ETH)
  const erc20Tokens = tokens.filter(
    (token) => token.address.toLowerCase() !== NATIVE_ETH.toLowerCase()
  );

  // Batch fetch all ERC20 balances using multicall with polling
  const { data: erc20Balances, isLoading: erc20Loading, refetch: refetchErc20 } = useReadContracts({
    contracts: erc20Tokens.map((token) => ({
      address: token.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    })),
    query: {
      enabled: isConnected && !!address && erc20Tokens.length > 0,
      refetchInterval: BALANCE_POLL_INTERVAL,
    },
  });

  // Manual refetch function
  const refetch = useCallback(() => {
    refetchEth();
    refetchErc20();
    fetchPrices();
  }, [refetchEth, refetchErc20, fetchPrices]);

  // Build portfolio with prices
  const balances: TokenBalance[] = [];
  let totalUsdValue = 0;

  // Add ETH balance with price
  if (ethBalance) {
    const ethPrice = prices["ETH"] || 0;
    const balanceNum = parseFloat(formatUnits(ethBalance.value, 18));
    const usdValue = balanceNum * ethPrice;
    totalUsdValue += usdValue;

    balances.push({
      symbol: "ETH",
      balance: formatUnits(ethBalance.value, 18),
      balanceRaw: ethBalance.value.toString(),
      decimals: 18,
      price: ethPrice,
      usdValue,
    });
  }

  // Add ERC20 balances with prices
  if (erc20Balances) {
    erc20Tokens.forEach((token, index) => {
      const result = erc20Balances[index];
      if (result.status === "success" && result.result) {
        const rawBalance = result.result as bigint;
        const balanceNum = parseFloat(formatUnits(rawBalance, token.decimals));
        const tokenPrice = prices[token.symbol] || 0;
        const usdValue = balanceNum * tokenPrice;
        totalUsdValue += usdValue;

        balances.push({
          symbol: token.symbol,
          balance: formatUnits(rawBalance, token.decimals),
          balanceRaw: rawBalance.toString(),
          decimals: token.decimals,
          price: tokenPrice,
          usdValue,
        });
      }
    });
  }

  return {
    balances,
    totalUsdValue,
    prices,
    isLoading: isLoadingTokens || ethLoading || erc20Loading || isLoadingPrices,
    refetch,
  };
}
