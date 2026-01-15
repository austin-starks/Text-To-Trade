"use client";

import { useAccount, useBalance, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { useEffect, useState } from "react";

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
}

export interface Portfolio {
  balances: TokenBalance[];
  totalUsdValue?: number;
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

// Popular tokens to check balances for (subset for performance)
const POPULAR_SYMBOLS = [
  "WETH", "USDC", "USDT", "DAI", "DEGEN", "BRETT", 
  "AERO", "cbBTC", "VIRTUAL", "TOSHI"
];

export function usePortfolio(): Portfolio {
  const { address, isConnected } = useAccount();
  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState(true);

  // Fetch token list from API
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

  // Fetch native ETH balance with polling
  const { data: ethBalance, isLoading: ethLoading, refetch: refetchEth } = useBalance({
    address,
    query: {
      enabled: isConnected && !!address,
      refetchInterval: 10000, // Poll every 10 seconds
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
      refetchInterval: 10000, // Poll every 10 seconds
    },
  });

  // Manual refetch function
  const refetch = () => {
    refetchEth();
    refetchErc20();
  };

  // Build portfolio
  const balances: TokenBalance[] = [];

  // Add ETH balance
  if (ethBalance) {
    balances.push({
      symbol: "ETH",
      balance: formatUnits(ethBalance.value, 18),
      balanceRaw: ethBalance.value.toString(),
      decimals: 18,
    });
  }

  // Add ERC20 balances
  if (erc20Balances) {
    erc20Tokens.forEach((token, index) => {
      const result = erc20Balances[index];
      if (result.status === "success" && result.result) {
        const rawBalance = result.result as bigint;
        balances.push({
          symbol: token.symbol,
          balance: formatUnits(rawBalance, token.decimals),
          balanceRaw: rawBalance.toString(),
          decimals: token.decimals,
        });
      }
    });
  }

  return {
    balances,
    isLoading: isLoadingTokens || ethLoading || erc20Loading,
    refetch,
  };
}

