"use client";

import { useEffect, useMemo, useState } from "react";
import { formatUnits } from "viem";
import { useAccount, useBalance, useReadContracts } from "wagmi";
import { BASE_TOKENS } from "../lib/tokens";

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

// Mock prices for USD value calculation
const MOCK_PRICES: Record<string, number> = {
  ETH: 3200,
  WETH: 3200,
  USDC: 1,
  USDT: 1,
  DAI: 1,
  DEGEN: 0.008,
  BRETT: 0.12,
  AERO: 1.2,
  cbBTC: 95000,
  VIRTUAL: 2.5,
  TOSHI: 0.0003,
};

interface TokenBalance {
  symbol: string;
  name: string;
  balance: string;
  balanceFormatted: string;
  usdValue: number;
  logoUrl?: string;
}

export default function WalletPortfolio() {
  const { address, isConnected } = useAccount();
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Fetch native ETH balance
  const { data: ethBalance, isLoading: ethLoading } = useBalance({
    address,
  });

  // Get ERC20 tokens (exclude native ETH)
  const erc20Tokens = useMemo(() => {
    return Object.values(BASE_TOKENS).filter(
      (token) => token.symbol !== "ETH" && token.address !== "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
    );
  }, []);

  // Fetch all ERC20 balances in one call
  const { data: tokenBalances, isLoading: tokensLoading } = useReadContracts({
    contracts: erc20Tokens.map((token) => ({
      address: token.address as `0x${string}`,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [address!],
    })),
    query: {
      enabled: !!address,
    },
  });

  // Combine all balances
  const portfolio: TokenBalance[] = useMemo(() => {
    const balances: TokenBalance[] = [];

    // Add ETH balance
    if (ethBalance) {
      const ethToken = BASE_TOKENS["ETH"];
      const balanceNum = parseFloat(ethBalance.formatted);
      const usdValue = balanceNum * (MOCK_PRICES["ETH"] || 0);

      if (balanceNum > 0) {
        balances.push({
          symbol: "ETH",
          name: ethToken.name,
          balance: ethBalance.value.toString(),
          balanceFormatted: formatBalance(ethBalance.formatted),
          usdValue,
          logoUrl: ethToken.logoUrl,
        });
      }
    }

    // Add ERC20 balances
    if (tokenBalances) {
      erc20Tokens.forEach((token, index) => {
        const result = tokenBalances[index];
        if (result.status === "success" && result.result) {
          const balance = result.result as bigint;
          if (balance > BigInt(0)) {
            const formatted = formatUnits(balance, token.decimals);
            const balanceNum = parseFloat(formatted);
            const usdValue = balanceNum * (MOCK_PRICES[token.symbol] || 0);

            balances.push({
              symbol: token.symbol,
              name: token.name,
              balance: balance.toString(),
              balanceFormatted: formatBalance(formatted),
              usdValue,
              logoUrl: token.logoUrl,
            });
          }
        }
      });
    }

    // Sort by USD value descending
    return balances.sort((a, b) => b.usdValue - a.usdValue);
  }, [ethBalance, tokenBalances, erc20Tokens]);

  const totalUsdValue = useMemo(() => {
    return portfolio.reduce((sum, token) => sum + token.usdValue, 0);
  }, [portfolio]);

  const isLoading = ethLoading || tokensLoading;

  // Show consistent loading state before hydration
  if (!mounted) {
    return (
      <div className="portfolio-container">
        <div className="portfolio-header">
          <div className="header-left">
            <span className="portfolio-icon">💼</span>
            <span className="portfolio-title">Portfolio</span>
          </div>
        </div>
        <div className="loading-state">
          <span className="spinner">⟳</span>
          <span>Loading...</span>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="portfolio-container">
        <div className="portfolio-header">
          <div className="header-left">
            <span className="portfolio-icon">💼</span>
            <span className="portfolio-title">Portfolio</span>
          </div>
        </div>
        <div className="portfolio-empty">
          <span className="empty-icon">🔗</span>
          <span className="empty-text">Connect wallet to view portfolio</span>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  return (
    <div className="portfolio-container">
      <div className="portfolio-header">
        <div className="header-left">
          <span className="portfolio-icon">💼</span>
          <span className="portfolio-title">Portfolio</span>
        </div>
        <div className="total-value">
          ${totalUsdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>

      <div className="portfolio-body">
        {isLoading ? (
          <div className="loading-state">
            <span className="spinner">⟳</span>
            <span>Loading balances...</span>
          </div>
        ) : portfolio.length === 0 ? (
          <div className="portfolio-empty">
            <span className="empty-icon">📭</span>
            <span className="empty-text">No tokens found in wallet</span>
          </div>
        ) : (
          <div className="token-list">
            {portfolio.map((token) => (
              <div key={token.symbol} className="token-row">
                <div className="token-info">
                  <div className="token-icon">
                    {token.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={token.logoUrl} alt={token.symbol} className="token-logo" />
                    ) : (
                      <span className="token-placeholder">{token.symbol[0]}</span>
                    )}
                  </div>
                  <div className="token-details">
                    <span className="token-symbol">{token.symbol}</span>
                    <span className="token-name">{token.name}</span>
                  </div>
                </div>
                <div className="token-balance">
                  <span className="balance-amount">{token.balanceFormatted}</span>
                  <span className="balance-usd">
                    ${token.usdValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="portfolio-footer">
        <span className="footer-note">Prices are estimates</span>
      </div>

      <style jsx>{styles}</style>
    </div>
  );
}

function formatBalance(value: string): string {
  const num = parseFloat(value);
  if (num === 0) return "0";
  if (num < 0.0001) return "<0.0001";
  if (num < 1) return num.toFixed(4);
  if (num < 1000) return num.toFixed(2);
  if (num < 1000000) return (num / 1000).toFixed(2) + "K";
  return (num / 1000000).toFixed(2) + "M";
}

const styles = `
  .portfolio-container {
    width: 100%;
    max-width: 320px;
    background: #0d1117;
    border-radius: 12px;
    overflow: hidden;
    border: 1px solid #21262d;
    font-family: "JetBrains Mono", "Fira Code", "SF Mono", monospace;
  }

  .portfolio-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    background: linear-gradient(180deg, #161b22 0%, #0d1117 100%);
    border-bottom: 1px solid #21262d;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .portfolio-icon {
    font-size: 14px;
  }

  .portfolio-title {
    color: #8b949e;
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .total-value {
    color: #3fb950;
    font-size: 14px;
    font-weight: 600;
  }

  .portfolio-body {
    max-height: 280px;
    overflow-y: auto;
    padding: 8px;
  }

  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 16px;
    color: #8b949e;
    font-size: 12px;
  }

  .spinner {
    animation: spin 1s linear infinite;
    color: #58a6ff;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .portfolio-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 32px 16px;
  }

  .empty-icon {
    font-size: 24px;
    opacity: 0.5;
  }

  .empty-text {
    color: #6e7681;
    font-size: 12px;
    text-align: center;
  }

  .token-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .token-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-radius: 8px;
    transition: background 0.15s ease;
  }

  .token-row:hover {
    background: #161b22;
  }

  .token-info {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .token-icon {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    overflow: hidden;
    background: #21262d;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .token-logo {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .token-placeholder {
    color: #8b949e;
    font-size: 14px;
    font-weight: 600;
  }

  .token-details {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .token-symbol {
    color: #f0f6fc;
    font-size: 13px;
    font-weight: 600;
  }

  .token-name {
    color: #6e7681;
    font-size: 10px;
  }

  .token-balance {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }

  .balance-amount {
    color: #f0f6fc;
    font-size: 13px;
    font-weight: 500;
  }

  .balance-usd {
    color: #8b949e;
    font-size: 10px;
  }

  .portfolio-footer {
    padding: 8px 16px;
    border-top: 1px solid #21262d;
    background: #161b22;
  }

  .footer-note {
    color: #484f58;
    font-size: 10px;
  }

  /* Scrollbar */
  .portfolio-body::-webkit-scrollbar {
    width: 6px;
  }

  .portfolio-body::-webkit-scrollbar-track {
    background: #0d1117;
  }

  .portfolio-body::-webkit-scrollbar-thumb {
    background: #30363d;
    border-radius: 3px;
  }

  .portfolio-body::-webkit-scrollbar-thumb:hover {
    background: #484f58;
  }
`;
