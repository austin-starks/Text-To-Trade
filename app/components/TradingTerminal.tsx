"use client";

import { useState, useRef, useEffect } from "react";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useSwitchChain, useReadContract, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { parseUnits, formatUnits, erc20Abi } from "viem";

// 1inch Aggregation Router v6 on Base
const INCH_ROUTER_ADDRESS = "0x111111125421ca6dc452d289314280a0f8842a65" as const;
// Native ETH address (used by 1inch)
const NATIVE_ETH_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
// Gas buffer to leave when selling all ETH (0.0005 ETH ~ $1.50 at $3000/ETH)
const ETH_GAS_BUFFER = BigInt("500000000000000"); // 0.0005 ETH in wei

// Sanitize amount string from LLM (removes token symbols, spaces, etc.)
function sanitizeAmount(amount: string): string {
  if (!amount) return "";
  // Extract just the numeric part (including decimals)
  const match = amount.match(/[\d.]+/);
  return match ? match[0] : "";
}
import { SUPPORTED_NETWORKS, SupportedChainId } from "../config";
import { parseTokenAmount } from "../lib/tokens";
import { getMockQuote } from "../lib/inch-api";
import { QuoteResult, TokenInfo } from "../types/order";
import { usePortfolio } from "../hooks/usePortfolio";
import StrategyPanel from "./StrategyPanel";
import TriggeredStrategyModal from "./TriggeredStrategyModal";
import { useStrategies } from "../contexts/StrategyContext";

// Token cache for resolving tokens
interface TokenCache {
  tokens: Record<string, TokenInfo>;
  count: number;
}



// LLM-parsed order from API
interface LLMParsedOrder {
  action: "swap" | "buy" | "sell";
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  buyAmount: string;
  confidence: number;
  reasoning: string;
}

interface BalanceCheck {
  hasSufficientBalance: boolean;
  availableBalance: string;
  shortfall: string;
}

interface Suggestion {
  hasAlternative: boolean;
  alternativeAction: string;
  alternativeSellToken: string;
  alternativeSellAmount: string;
  alternativeBuyToken: string;
}

interface ParseOrderResponse {
  success: boolean;
  intent: "trade" | "question";
  answer: string;
  order: LLMParsedOrder;
  balanceCheck: BalanceCheck;
  suggestion: Suggestion;
  error?: string;
}

interface HistoryEntry {
  id: string;
  type: "input" | "parsed" | "quote" | "error" | "thinking" | "success" | "confirm";
  content: string;
  timestamp: Date;
}

interface PendingTrade {
  quote: QuoteResult;
  sellToken: TokenInfo;
  buyToken: TokenInfo;
  sellAmountWei: string;
}

export default function TradingTerminal() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pendingTrade, setPendingTrade] = useState<PendingTrade | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>();
  const [showNetworkMenu, setShowNetworkMenu] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const networkMenuRef = useRef<HTMLDivElement>(null);

  // Prevent hydration mismatch for wallet-dependent UI
  useEffect(() => {
    setMounted(true);
  }, []);

  const { chain } = useAccount();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const currentChainId = (chain?.id ?? base.id) as SupportedChainId;
  const currentNetwork = SUPPORTED_NETWORKS[currentChainId] ?? SUPPORTED_NETWORKS[base.id];

  // Close network menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (networkMenuRef.current && !networkMenuRef.current.contains(e.target as Node)) {
        setShowNetworkMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNetworkSwitch = (chainId: SupportedChainId) => {
    if (chainId !== currentChainId) {
      switchChain({ chainId });
    }
    setShowNetworkMenu(false);
  };

  // Wagmi hooks
  const { address, isConnected } = useAccount();
  const { sendTransaction, isPending: isSending } = useSendTransaction();
  const { writeContract, isPending: isApproving } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });
  
  // Approval state
  const [approvalTxHash, setApprovalTxHash] = useState<`0x${string}` | undefined>();
  const { isLoading: isApprovalConfirming, isSuccess: isApprovalSuccess } = useWaitForTransactionReceipt({
    hash: approvalTxHash,
  });

  // Portfolio hook - fetches all token balances
  const portfolio = usePortfolio();

  // Strategy hook - manages trading strategies
  const { 
    triggeredStrategies, 
    snoozeStrategy, 
    markExecuted, 
    dismissTriggered,
    setBalances,
  } = useStrategies();

  // Sync portfolio balances to strategy context for real-time evaluation
  // Use JSON.stringify to prevent infinite loops (portfolio.balances is new array each render)
  const balancesKey = JSON.stringify(
    portfolio.balances.map(b => ({ s: b.symbol, b: b.balance }))
  );
  useEffect(() => {
    if (portfolio.balances.length > 0) {
      const balanceMap: Record<string, number> = {};
      portfolio.balances.forEach((b) => {
        balanceMap[b.symbol] = parseFloat(b.balance);
      });
      setBalances(balanceMap);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [balancesKey]); // Use stable key instead of object reference

  // Get the first triggered strategy to show (FIFO)
  const currentTriggeredStrategy = triggeredStrategies[0];

  // Token cache - fetched from 1inch API
  const [tokenCache, setTokenCache] = useState<TokenCache>({ tokens: {}, count: 0 });
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [tokenSearch, setTokenSearch] = useState("");
  const [showStrategyPanel, setShowStrategyPanel] = useState(false);

  // Fetch tokens on mount
  useEffect(() => {
    async function fetchTokens() {
      try {
        const response = await fetch("/api/tokens");
        const data = await response.json();
        if (data.success && data.tokens) {
          setTokenCache({ tokens: data.tokens, count: data.count });
        }
      } catch (error) {
        console.warn("Failed to fetch token list");
      }
    }
    fetchTokens();
  }, []);

  // Resolve token from cache
  const resolveToken = (symbol: string): TokenInfo | null => {
    const normalized = symbol.toUpperCase().trim();
    return tokenCache.tokens[normalized] || null;
  };

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  // Handle successful transaction
  useEffect(() => {
    if (isTxSuccess && txHash) {
      addToHistory("success", `✅ Transaction confirmed! Hash: ${txHash.slice(0, 10)}...${txHash.slice(-8)}`);
      setPendingTrade(null);
      setTxHash(undefined);
      // Refetch portfolio after successful swap
      setTimeout(() => portfolio.refetch(), 2000); // Wait 2s for chain to update
    }
  }, [isTxSuccess, txHash]);

  // Handle successful approval - automatically proceed with swap
  useEffect(() => {
    if (isApprovalSuccess && approvalTxHash && pendingTrade) {
      addToHistory("success", `✅ Approval confirmed! Now executing swap...`);
      setApprovalTxHash(undefined);
      // Proceed with the swap after approval
      executeSwap();
    }
  }, [isApprovalSuccess, approvalTxHash]);

  const addToHistory = (type: HistoryEntry["type"], content: string) => {
    setHistory((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type,
        content,
        timestamp: new Date(),
      },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userInput = input.trim();
    setInput("");
    setIsProcessing(true);
    setPendingTrade(null); // Clear any pending trade

    addToHistory("input", userInput);
    addToHistory("thinking", "Parsing with AI...");

    try {
      // Prepare portfolio data for the API
      const portfolioData = portfolio.balances.map((b) => ({
        symbol: b.symbol,
        balance: b.balance,
      }));

      // Call the LLM API to parse the order
      const response = await fetch("/api/parse-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          input: userInput,
          portfolio: isConnected ? portfolioData : undefined,
        }),
      });

      const data: ParseOrderResponse = await response.json();

      // Remove thinking message
      setHistory((prev) => prev.filter((h) => h.type !== "thinking"));

      if (!data.success) {
        addToHistory("error", data.error || "Could not understand that request");
        setIsProcessing(false);
        return;
      }

      // Handle questions
      if (data.intent === "question") {
        addToHistory("parsed", `🤖 ${data.answer}`);
        setIsProcessing(false);
        return;
      }

      // Handle trades
      if (!data.order) {
        addToHistory("error", "Could not parse trade request");
        setIsProcessing(false);
        return;
      }

      const order = data.order;
      const balanceCheck = data.balanceCheck;
      const suggestion = data.suggestion;

      // Show confidence and reasoning
      const confidenceEmoji = order.confidence >= 0.8 ? "🟢" : order.confidence >= 0.5 ? "🟡" : "🔴";
      addToHistory(
        "parsed",
        `${confidenceEmoji} Parsed: ${order.action.toUpperCase()} ${order.sellAmount || "?"} ${order.sellToken} → ${order.buyToken}`
      );

      if (order.reasoning) {
        addToHistory("parsed", `AI: ${order.reasoning}`);
      }

      // Check balance and show warnings/suggestions
      if (balanceCheck && !balanceCheck.hasSufficientBalance) {
        if (balanceCheck.availableBalance) {
          addToHistory("error", `⚠️ Insufficient ${order.sellToken}: You have ${balanceCheck.availableBalance}, need ${order.sellAmount || "more"}`);
        }
        if (balanceCheck.shortfall) {
          addToHistory("error", `Shortfall: ${balanceCheck.shortfall} ${order.sellToken}`);
        }
        
        // Show alternative suggestion
        if (suggestion && suggestion.hasAlternative) {
          addToHistory("quote", `💡 Suggestion: ${suggestion.alternativeAction}`);
          if (suggestion.alternativeSellToken && suggestion.alternativeSellAmount && suggestion.alternativeBuyToken) {
            addToHistory("confirm", `Try: "swap ${suggestion.alternativeSellAmount} ${suggestion.alternativeSellToken} for ${suggestion.alternativeBuyToken}"`);
          }
        }
        
        setIsProcessing(false);
        return;
      }

      // Validate tokens exist
      const sellToken = resolveToken(order.sellToken);
      const buyToken = resolveToken(order.buyToken);

      if (!sellToken || !buyToken) {
        addToHistory("error", `Token not found: ${!sellToken ? order.sellToken : order.buyToken}`);
        setIsProcessing(false);
        return;
      }

      // Calculate sell amount (sanitize to remove any token symbols from LLM output)
      let sellAmountWei: string;
      const cleanSellAmount = sanitizeAmount(order.sellAmount);
      const cleanBuyAmount = sanitizeAmount(order.buyAmount);

      if (cleanSellAmount && cleanSellAmount !== "") {
        sellAmountWei = parseTokenAmount(cleanSellAmount, sellToken.decimals);
      } else if (cleanBuyAmount && cleanBuyAmount !== "") {
        // Estimate sell amount based on mock prices
        const mockPrices: Record<string, number> = {
          ETH: 3200, WETH: 3200, USDC: 1, USDT: 1, DAI: 1,
          DEGEN: 0.008, BRETT: 0.12, AERO: 1.2, cbBTC: 95000,
          VIRTUAL: 2.5, TOSHI: 0.0003,
        };
        const buyPrice = mockPrices[buyToken.symbol] || 1;
        const sellPrice = mockPrices[sellToken.symbol] || 1;
        const buyAmountNum = Number(cleanBuyAmount);
        const estimatedSellAmount = (buyAmountNum * buyPrice) / sellPrice;
        sellAmountWei = parseTokenAmount(estimatedSellAmount.toFixed(6), sellToken.decimals);

        addToHistory("parsed", `Estimated: ~${estimatedSellAmount.toFixed(2)} ${sellToken.symbol} needed`);
      } else {
        addToHistory("error", "Need an amount to get a quote");
        setIsProcessing(false);
        return;
      }

      // Get quote (mock for now, ready for real 1inch)
      const quote = getMockQuote(sellToken, buyToken, sellAmountWei);

      addToHistory(
        "quote",
        `Quote: ${quote.sellAmountDisplay} ${quote.sellToken.symbol} → ${quote.buyAmountDisplay} ${quote.buyToken.symbol}`
      );
      addToHistory(
        "quote",
        `Route: ${quote.protocols.join(" → ")} | Gas: ~${Number(quote.estimatedGas).toLocaleString()}`
      );

      // Set pending trade for confirmation
      setPendingTrade({
        quote,
        sellToken,
        buyToken,
        sellAmountWei,
      });

      addToHistory("confirm", "Review the trade above and click Confirm to execute");

    } catch (error) {
      setHistory((prev) => prev.filter((h) => h.type !== "thinking"));
      addToHistory("error", error instanceof Error ? error.message : "Failed to process order");
    }

    setIsProcessing(false);
  };

  // Check if token needs approval and request it
  const checkAndRequestApproval = async (): Promise<boolean> => {
    if (!pendingTrade || !address) return false;
    
    const sellTokenAddress = pendingTrade.sellToken.address.toLowerCase();
    
    // Native ETH doesn't need approval
    if (sellTokenAddress === NATIVE_ETH_ADDRESS.toLowerCase()) {
      return true; // No approval needed
    }

    addToHistory("thinking", "Checking token allowance...");

    try {
      // Check current allowance via API
      const response = await fetch(`/api/allowance?token=${pendingTrade.sellToken.address}&owner=${address}&spender=${INCH_ROUTER_ADDRESS}`);
      const data = await response.json();
      
      setHistory((prev) => prev.filter((h) => h.type !== "thinking"));

      if (!data.success) {
        // If we can't check allowance, try to approve anyway
        addToHistory("quote", "Requesting token approval...");
      } else {
        const currentAllowance = BigInt(data.allowance || "0");
        const requiredAmount = BigInt(pendingTrade.sellAmountWei);
        
        if (currentAllowance >= requiredAmount) {
          return true; // Already approved
        }
        
        addToHistory("quote", `🔐 Approval needed for ${pendingTrade.sellToken.symbol}`);
      }

      // Request approval
      addToHistory("thinking", "Confirm approval in your wallet...");
      
      writeContract(
        {
          address: pendingTrade.sellToken.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "approve",
          args: [INCH_ROUTER_ADDRESS, BigInt(pendingTrade.sellAmountWei)],
        },
        {
          onSuccess: (hash) => {
            setHistory((prev) => prev.filter((h) => h.type !== "thinking"));
            setApprovalTxHash(hash);
            addToHistory("success", `📤 Approval sent! Waiting for confirmation...`);
          },
          onError: (error) => {
            setHistory((prev) => prev.filter((h) => h.type !== "thinking"));
            addToHistory("error", `Approval failed: ${error.message}`);
          },
        }
      );
      
      return false; // Approval in progress, don't proceed with swap yet
    } catch (error) {
      setHistory((prev) => prev.filter((h) => h.type !== "thinking"));
      addToHistory("error", error instanceof Error ? error.message : "Failed to check allowance");
      return false;
    }
  };

  // Execute the swap transaction
  const executeSwap = async () => {
    if (!pendingTrade || !address) return;

    const isTestnet = currentChainId !== 8453;

    // On testnet, run simulation mode
    if (isTestnet) {
      addToHistory("thinking", "Running simulation...");
      
      // Small delay to simulate processing
      await new Promise(resolve => setTimeout(resolve, 500));
      
      setHistory((prev) => prev.filter((h) => h.type !== "thinking"));
      addToHistory("success", `🧪 [SIMULATED] Swap successful!`);
      addToHistory("quote", `Would swap: ${pendingTrade.quote.sellAmountDisplay} ${pendingTrade.sellToken.symbol} → ${pendingTrade.quote.buyAmountDisplay} ${pendingTrade.buyToken.symbol}`);
      addToHistory("parsed", `ℹ️ This is a testnet simulation. Switch to Base Mainnet for real trades.`);
      setPendingTrade(null);
      return;
    }

    addToHistory("thinking", "Preparing swap transaction...");

    try {
      // If selling native ETH, leave some for gas
      let swapAmount = pendingTrade.sellAmountWei;
      const isSellingEth = pendingTrade.sellToken.address.toLowerCase() === NATIVE_ETH_ADDRESS.toLowerCase();
      
      if (isSellingEth) {
        const amountBigInt = BigInt(swapAmount);
        if (amountBigInt > ETH_GAS_BUFFER) {
          // Check if user might be swapping most of their ETH
          const ethBalance = portfolio.balances.find(b => b.symbol === "ETH");
          if (ethBalance) {
            const balanceWei = BigInt(parseUnits(ethBalance.balance, 18));
            const requestedAmount = BigInt(swapAmount);
            // If swapping more than 95% of balance, leave gas buffer
            if (requestedAmount > (balanceWei * BigInt(95)) / BigInt(100)) {
              swapAmount = (balanceWei - ETH_GAS_BUFFER).toString();
              addToHistory("quote", `📝 Adjusted to leave gas: swapping ${formatUnits(BigInt(swapAmount), 18)} ETH`);
            }
          }
        }
      }

      const response = await fetch("/api/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          src: pendingTrade.sellToken.address,
          dst: pendingTrade.buyToken.address,
          amount: swapAmount,
          from: address,
          slippage: 1,
        }),
      });

      const data = await response.json();
      setHistory((prev) => prev.filter((h) => h.type !== "thinking"));

      if (!data.success) {
        addToHistory("error", data.error || "Failed to prepare swap");
        return;
      }

      if (data.mock) {
        addToHistory("quote", "⚠️ Preview mode - no 1inch API key configured");
        addToHistory("success", "Would execute: " + JSON.stringify({
          to: data.tx.to,
          value: data.tx.value,
        }));
        setPendingTrade(null);
        return;
      }

      addToHistory("thinking", "Confirm swap in your wallet...");

      sendTransaction(
        {
          to: data.tx.to as `0x${string}`,
          data: data.tx.data as `0x${string}`,
          value: BigInt(data.tx.value || "0"),
          gas: BigInt(data.tx.gas || "300000"),
        },
        {
          onSuccess: (hash) => {
            setHistory((prev) => prev.filter((h) => h.type !== "thinking"));
            setTxHash(hash);
            addToHistory("success", `📤 Swap sent! Waiting for confirmation...`);
          },
          onError: (error) => {
            setHistory((prev) => prev.filter((h) => h.type !== "thinking"));
            addToHistory("error", `Swap failed: ${error.message}`);
          },
        }
      );
    } catch (error) {
      setHistory((prev) => prev.filter((h) => h.type !== "thinking"));
      addToHistory("error", error instanceof Error ? error.message : "Failed to execute swap");
    }
  };

  const handleConfirmTrade = async () => {
    if (!pendingTrade || !address) {
      addToHistory("error", "Please connect your wallet first");
      return;
    }

    // On testnet, skip approval and go straight to simulation
    if (currentChainId !== 8453) {
      await executeSwap();
      return;
    }

    // Check and request approval if needed (mainnet only)
    const isApproved = await checkAndRequestApproval();
    
    if (isApproved) {
      // Already approved or native ETH, proceed with swap
      await executeSwap();
    }
    // If not approved, the approval flow will trigger executeSwap after confirmation
  };

  const handleCancelTrade = () => {
    setPendingTrade(null);
    addToHistory("error", "Trade cancelled");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setInput("");
      if (pendingTrade) {
        handleCancelTrade();
      }
    }
  };

  return (
    <div className="terminal-container">
      {/* Terminal Header */}
      <div className="terminal-header">
        <div className="terminal-dots">
          <span className="dot dot-red"></span>
          <span className="dot dot-yellow"></span>
          <span className="dot dot-green"></span>
        </div>
        <div className="terminal-title">text-to-trade</div>
        <div className="network-selector" ref={networkMenuRef}>
          <button
            className="network-btn"
            onClick={() => setShowNetworkMenu(!showNetworkMenu)}
            disabled={isSwitching}
          >
            <span
              className="status-dot"
              style={{ background: currentNetwork.color }}
            ></span>
            {isSwitching ? "Switching..." : currentNetwork.name}
            <span className="chevron">{showNetworkMenu ? "▲" : "▼"}</span>
          </button>
          {showNetworkMenu && (
            <div className="network-menu">
              {Object.entries(SUPPORTED_NETWORKS).map(([id, network]) => {
                const isTestnet = Number(id) !== 8453;
                return (
                  <button
                    key={id}
                    className={`network-option ${Number(id) === currentChainId ? "active" : ""}`}
                    onClick={() => handleNetworkSwitch(Number(id) as SupportedChainId)}
                  >
                    <span
                      className="option-dot"
                      style={{ background: network.color }}
                    ></span>
                    <span className="option-name">
                      {network.name}
                      {isTestnet && <span className="testnet-label">TEST</span>}
                      {!isTestnet && <span className="mainnet-label">REAL $</span>}
                    </span>
                    {Number(id) === currentChainId && <span className="check">✓</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Testnet Warning Banner */}
      {currentChainId !== 8453 && (
        <div className="testnet-banner">
          <span className="testnet-icon">🧪</span>
          <span className="testnet-text">
            <strong>TEST MODE</strong> — Trades are simulated. No real tokens exchanged.
          </span>
          <button 
            className="testnet-switch-btn"
            onClick={() => handleNetworkSwitch(8453)}
            disabled={isSwitching}
          >
            {isSwitching ? "Switching..." : "Trade Real $ →"}
          </button>
        </div>
      )}

      {/* Terminal Body */}
      <div className="terminal-body">
        {/* Welcome message */}
        {history.length === 0 && (
          <div className="welcome-section">
            <pre className="ascii-art">
{`  ████████╗███████╗██╗  ██╗████████╗
  ╚══██╔══╝██╔════╝╚██╗██╔╝╚══██╔══╝
     ██║   █████╗   ╚███╔╝    ██║   
     ██║   ██╔══╝   ██╔██╗    ██║   
     ██║   ███████╗██╔╝ ██╗   ██║   
     ╚═╝   ╚══════╝╚═╝  ╚═╝   ╚═╝   
  ████████╗ ██████╗ 
  ╚══██╔══╝██╔═══██╗
     ██║   ██║   ██║
     ██║   ██║   ██║
     ██║   ╚██████╔╝
     ╚═╝    ╚═════╝ 
  ████████╗██████╗  █████╗ ██████╗ ███████╗
  ╚══██╔══╝██╔══██╗██╔══██╗██╔══██╗██╔════╝
     ██║   ██████╔╝███████║██║  ██║█████╗  
     ██║   ██╔══██╗██╔══██║██║  ██║██╔══╝  
     ██║   ██║  ██║██║  ██║██████╔╝███████╗
     ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝ ╚══════╝`}
            </pre>
            <div className="welcome-text">
              <p className="welcome-title">Natural Language Trading on Base</p>
              <p className="welcome-subtitle">Type your trade in plain English</p>
            </div>
            <div className="examples">
              <div className="example-label">Try these:</div>
              <button className="example-btn" onClick={() => setInput("swap 100 USDC for ETH")}>
                swap 100 USDC for ETH
              </button>
              <button className="example-btn" onClick={() => setInput("ape into DEGEN with $50")}>
                ape into DEGEN with $50
              </button>
              <button className="example-btn" onClick={() => setInput("dump 0.1 ETH for stables")}>
                dump 0.1 ETH for stables
              </button>
              <button className="example-btn" onClick={() => setInput("get me some BRETT, like $20 worth")}>
                get me some BRETT, like $20 worth
              </button>
            </div>
          </div>
        )}

        {/* History */}
        <div className="history">
          {history.map((entry) => (
            <div key={entry.id} className={`history-entry ${entry.type}`}>
              <span className="entry-prefix">
                {entry.type === "input" && "›"}
                {entry.type === "parsed" && "✓"}
                {entry.type === "quote" && "◆"}
                {entry.type === "error" && "✗"}
                {entry.type === "thinking" && "⟳"}
                {entry.type === "success" && "✓"}
                {entry.type === "confirm" && "?"}
              </span>
              <span className="entry-content">{entry.content}</span>
            </div>
          ))}
          <div ref={historyEndRef} />
        </div>

        {/* Confirmation Panel */}
        {pendingTrade && (
          <div className="confirm-panel">
            <div className="confirm-header">
              <span className="confirm-icon">⚡</span>
              <span>Ready to Execute</span>
            </div>
            <div className="confirm-details">
              <div className="confirm-row">
                <span className="confirm-label">You Pay</span>
                <span className="confirm-value sell">
                  {pendingTrade.quote.sellAmountDisplay} {pendingTrade.quote.sellToken.symbol}
                </span>
              </div>
              <div className="confirm-arrow">↓</div>
              <div className="confirm-row">
                <span className="confirm-label">You Receive</span>
                <span className="confirm-value buy">
                  {pendingTrade.quote.buyAmountDisplay} {pendingTrade.quote.buyToken.symbol}
                </span>
              </div>
              <div className="confirm-row small">
                <span className="confirm-label">Route</span>
                <span className="confirm-value">{pendingTrade.quote.protocols.join(" → ")}</span>
              </div>
              <div className="confirm-row small">
                <span className="confirm-label">Est. Gas</span>
                <span className="confirm-value">~{Number(pendingTrade.quote.estimatedGas).toLocaleString()}</span>
              </div>
            </div>
            <div className="confirm-actions">
              <button
                className="confirm-btn cancel"
                onClick={handleCancelTrade}
                disabled={isSending || isConfirming}
              >
                Cancel
              </button>
              <button
                className={`confirm-btn execute ${currentChainId !== 8453 ? "testnet-mode" : ""}`}
                onClick={handleConfirmTrade}
                disabled={isSending || isConfirming || isApproving || isApprovalConfirming || !isConnected}
              >
                {!isConnected
                  ? "Connect Wallet"
                  : isApproving
                  ? "Approve in Wallet..."
                  : isApprovalConfirming
                  ? "Approving..."
                  : isSending
                  ? "Confirm in Wallet..."
                  : isConfirming
                  ? "Confirming..."
                  : currentChainId !== 8453
                  ? "🧪 Simulate Trade"
                  : "⚡ Execute Trade"}
              </button>
            </div>
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} className="input-form">
          <span className="input-prompt">›</span>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isProcessing ? "Processing..." : "Enter your trade..."}
            disabled={isProcessing}
            className="terminal-input"
            autoFocus
          />
          {isProcessing && <span className="processing-indicator">⟳</span>}
        </form>
      </div>

      {/* Footer */}
      {/* Token List Modal */}
      {showTokenModal && (
        <div className="modal-overlay" onClick={() => setShowTokenModal(false)}>
          <div className="token-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Supported Tokens ({tokenCache.count})</h3>
              <button className="modal-close" onClick={() => setShowTokenModal(false)}>×</button>
            </div>
            <div className="modal-search">
              <input
                type="text"
                placeholder="Search tokens..."
                value={tokenSearch}
                onChange={(e) => setTokenSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="token-list">
              {Object.values(tokenCache.tokens)
                .filter((token) => 
                  token.symbol.toLowerCase().includes(tokenSearch.toLowerCase()) ||
                  token.name.toLowerCase().includes(tokenSearch.toLowerCase())
                )
                .sort((a, b) => a.symbol.localeCompare(b.symbol))
                .map((token) => (
                  <div 
                    key={token.symbol} 
                    className="token-item"
                    onClick={() => {
                      setInput(`swap ${token.symbol} for `);
                      setShowTokenModal(false);
                      setTokenSearch("");
                      inputRef.current?.focus();
                    }}
                  >
                    <div className="token-icon">
                      {token.logoUrl ? (
                        <img src={token.logoUrl} alt={token.symbol} onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }} />
                      ) : (
                        <span>{token.symbol.slice(0, 2)}</span>
                      )}
                    </div>
                    <div className="token-info">
                      <span className="token-symbol">{token.symbol}</span>
                      <span className="token-name">{token.name}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Strategy Panel Modal */}
      {showStrategyPanel && (
        <div className="modal-overlay" onClick={() => setShowStrategyPanel(false)}>
          <div className="strategy-modal" onClick={(e) => e.stopPropagation()}>
            <StrategyPanel onClose={() => setShowStrategyPanel(false)} />
          </div>
        </div>
      )}

      {/* Triggered Strategy Modal */}
      {currentTriggeredStrategy && (
        <TriggeredStrategyModal
          strategy={currentTriggeredStrategy.strategy}
          currentValue={currentTriggeredStrategy.evaluation.currentValues.lhs}
          targetValue={currentTriggeredStrategy.evaluation.currentValues.rhs}
          onExecute={async () => {
            // For swap actions, we'd trigger the trade here
            // For now, mark as executed
            markExecuted(currentTriggeredStrategy.strategy.id);
            // If it's a swap, trigger the trade flow
            if (currentTriggeredStrategy.strategy.action.type === "swap") {
              const action = currentTriggeredStrategy.strategy.action;
              setInput(`swap ${action.sellPercentage || 10}% ${action.sellToken} for ${action.buyToken}`);
              // Note: User will need to submit this manually for safety
              addToHistory("confirm", `📊 Strategy "${currentTriggeredStrategy.strategy.name}" triggered! Review and execute the trade above.`);
            }
          }}
          onDismiss={() => dismissTriggered(currentTriggeredStrategy.strategy.id)}
          onSnooze={() => snoozeStrategy(currentTriggeredStrategy.strategy.id, 60)}
        />
      )}

      <div className="terminal-footer">
        <div className="footer-left">
          <button 
            className="token-badge clickable strategy-btn"
            onClick={() => setShowStrategyPanel(!showStrategyPanel)}
          >
            📊 Strategies
          </button>
          <span className="token-badge">ETH</span>
          <span className="token-badge">USDC</span>
          <button 
            className="token-badge clickable"
            onClick={() => setShowTokenModal(true)}
          >
            {tokenCache.count > 0 ? `+${tokenCache.count - 3} more` : "loading..."}
          </button>
        </div>
        <div className="footer-right">
          {!mounted ? (
            <span className="wallet-badge">Loading...</span>
          ) : isConnected ? (
            <span className="wallet-badge connected">
              🟢 {address?.slice(0, 6)}...{address?.slice(-4)}
            </span>
          ) : (
            <span className="wallet-badge">Connect Wallet</span>
          )}
        </div>
      </div>

      <style jsx>{`
        .terminal-container {
          width: 100%;
          max-width: 720px;
          background: #0d1117;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 
            0 0 0 1px rgba(99, 179, 237, 0.1),
            0 25px 50px -12px rgba(0, 0, 0, 0.6),
            0 0 100px rgba(99, 179, 237, 0.05);
          font-family: "JetBrains Mono", "Fira Code", "SF Mono", monospace;
        }

        .terminal-header {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          background: linear-gradient(180deg, #161b22 0%, #0d1117 100%);
          border-bottom: 1px solid #21262d;
        }

        /* Testnet Banner */
        .testnet-banner {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 10px 16px;
          background: linear-gradient(90deg, rgba(251, 191, 36, 0.15) 0%, rgba(245, 158, 11, 0.1) 100%);
          border-bottom: 1px solid rgba(251, 191, 36, 0.3);
          flex-wrap: wrap;
        }

        .testnet-icon {
          font-size: 16px;
        }

        .testnet-text {
          color: #fbbf24;
          font-size: 12px;
        }

        .testnet-text strong {
          color: #fcd34d;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .testnet-switch-btn {
          background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
          border: none;
          color: #ffffff;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 11px;
          font-family: inherit;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .testnet-switch-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);
          box-shadow: 0 0 15px rgba(59, 130, 246, 0.4);
        }

        .testnet-switch-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .terminal-dots {
          display: flex;
          gap: 8px;
        }

        .dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
        }

        .dot-red { background: #ff5f57; }
        .dot-yellow { background: #febc2e; }
        .dot-green { background: #28c840; }

        .terminal-title {
          flex: 1;
          text-align: center;
          color: #8b949e;
          font-size: 13px;
          font-weight: 500;
        }

        .terminal-status {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #3fb950;
          font-size: 11px;
          font-weight: 500;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          background: #3fb950;
          border-radius: 50%;
          animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .network-selector {
          position: relative;
        }

        .network-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: #21262d;
          border: 1px solid #30363d;
          color: #f0f6fc;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 11px;
          font-family: inherit;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .network-btn:hover {
          background: #30363d;
          border-color: #484f58;
        }

        .network-btn:disabled {
          opacity: 0.7;
          cursor: not-allowed;
        }

        .chevron {
          font-size: 8px;
          color: #8b949e;
          margin-left: 2px;
        }

        .network-menu {
          position: absolute;
          top: calc(100% + 4px);
          right: 0;
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 8px;
          overflow: hidden;
          min-width: 160px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
          z-index: 100;
        }

        .network-option {
          display: flex;
          align-items: center;
          gap: 8px;
          width: 100%;
          padding: 10px 12px;
          background: transparent;
          border: none;
          color: #f0f6fc;
          font-size: 12px;
          font-family: inherit;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .network-option:hover {
          background: #21262d;
        }

        .network-option.active {
          background: rgba(88, 166, 255, 0.1);
        }

        .option-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .option-name {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .testnet-label {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
          font-size: 9px;
          padding: 2px 5px;
          border-radius: 3px;
          font-weight: 600;
        }

        .mainnet-label {
          background: rgba(63, 185, 80, 0.2);
          color: #3fb950;
          font-size: 9px;
          padding: 2px 5px;
          border-radius: 3px;
          font-weight: 600;
        }

        .check {
          margin-left: auto;
          color: #3fb950;
        }

        .terminal-body {
          min-height: 400px;
          max-height: 500px;
          overflow-y: auto;
          padding: 20px;
        }

        .welcome-section {
          margin-bottom: 24px;
        }

        .ascii-art {
          color: #58a6ff;
          font-size: 6px;
          line-height: 1.1;
          margin-bottom: 20px;
          text-align: center;
          text-shadow: 0 0 20px rgba(88, 166, 255, 0.3);
        }

        .welcome-text {
          text-align: center;
          margin-bottom: 24px;
        }

        .welcome-title {
          color: #f0f6fc;
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 4px;
        }

        .welcome-subtitle {
          color: #8b949e;
          font-size: 13px;
        }

        .examples {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: center;
          align-items: center;
        }

        .example-label {
          color: #6e7681;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .example-btn {
          background: #21262d;
          border: 1px solid #30363d;
          color: #7ee787;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .example-btn:hover {
          background: #30363d;
          border-color: #58a6ff;
          color: #58a6ff;
        }

        .history {
          margin-bottom: 16px;
        }

        .history-entry {
          display: flex;
          gap: 10px;
          padding: 6px 0;
          font-size: 14px;
          line-height: 1.5;
        }

        .entry-prefix {
          flex-shrink: 0;
          width: 16px;
          text-align: center;
        }

        .history-entry.input .entry-prefix { color: #58a6ff; }
        .history-entry.input .entry-content { color: #f0f6fc; }

        .history-entry.parsed .entry-prefix { color: #3fb950; }
        .history-entry.parsed .entry-content { color: #7ee787; }

        .history-entry.quote .entry-prefix { color: #a371f7; }
        .history-entry.quote .entry-content { color: #d2a8ff; }

        .history-entry.error .entry-prefix { color: #f85149; }
        .history-entry.error .entry-content { color: #ffa198; }

        .history-entry.thinking .entry-prefix { color: #8b949e; }
        .history-entry.thinking .entry-content { 
          color: #8b949e;
          animation: blink 1s ease-in-out infinite;
        }

        .history-entry.success .entry-prefix { color: #3fb950; }
        .history-entry.success .entry-content { color: #7ee787; }

        .history-entry.confirm .entry-prefix { color: #f0883e; }
        .history-entry.confirm .entry-content { color: #f0883e; }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }

        /* Confirmation Panel */
        .confirm-panel {
          background: linear-gradient(135deg, #161b22 0%, #1c2128 100%);
          border: 1px solid #30363d;
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 16px;
          animation: slideIn 0.3s ease;
        }

        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .confirm-header {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #f0883e;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 16px;
        }

        .confirm-icon {
          font-size: 18px;
        }

        .confirm-details {
          background: #0d1117;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 16px;
        }

        .confirm-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
        }

        .confirm-row.small {
          padding: 4px 0;
          font-size: 12px;
        }

        .confirm-label {
          color: #8b949e;
          font-size: 12px;
        }

        .confirm-value {
          color: #f0f6fc;
          font-weight: 500;
        }

        .confirm-value.sell {
          color: #f85149;
        }

        .confirm-value.buy {
          color: #3fb950;
          font-size: 18px;
        }

        .confirm-arrow {
          text-align: center;
          color: #484f58;
          font-size: 18px;
          padding: 4px 0;
        }

        .confirm-actions {
          display: flex;
          gap: 12px;
        }

        .confirm-btn {
          flex: 1;
          padding: 12px 20px;
          border-radius: 8px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .confirm-btn.cancel {
          background: transparent;
          border: 1px solid #30363d;
          color: #8b949e;
        }

        .confirm-btn.cancel:hover:not(:disabled) {
          background: #21262d;
          border-color: #f85149;
          color: #f85149;
        }

        .confirm-btn.execute {
          background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
          border: none;
          color: #ffffff;
        }

        .confirm-btn.execute:hover:not(:disabled) {
          background: linear-gradient(135deg, #2ea043 0%, #3fb950 100%);
          box-shadow: 0 0 20px rgba(46, 160, 67, 0.4);
        }

        .confirm-btn.execute.testnet-mode {
          background: linear-gradient(135deg, #7c3aed 0%, #8b5cf6 100%);
        }

        .confirm-btn.execute.testnet-mode:hover:not(:disabled) {
          background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%);
          box-shadow: 0 0 20px rgba(139, 92, 246, 0.4);
        }

        .confirm-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .input-form {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          background: #161b22;
          border-radius: 8px;
          border: 1px solid #30363d;
        }

        .input-form:focus-within {
          border-color: #58a6ff;
          box-shadow: 0 0 0 3px rgba(88, 166, 255, 0.1);
        }

        .input-prompt {
          color: #58a6ff;
          font-size: 18px;
          font-weight: 600;
        }

        .terminal-input {
          flex: 1;
          background: transparent;
          border: none;
          color: #f0f6fc;
          font-size: 15px;
          font-family: inherit;
          outline: none;
        }

        .terminal-input::placeholder {
          color: #484f58;
        }

        .processing-indicator {
          color: #58a6ff;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .terminal-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 16px;
          background: #161b22;
          border-top: 1px solid #21262d;
        }

        .footer-left {
          display: flex;
          gap: 6px;
        }

        .token-badge {
          background: #21262d;
          color: #8b949e;
          padding: 3px 8px;
          border-radius: 4px;
          font-size: 10px;
          font-weight: 500;
          border: none;
          font-family: inherit;
        }

        .token-badge.clickable {
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .token-badge.clickable:hover {
          background: #30363d;
          color: #58a6ff;
        }

        .token-badge.strategy-btn {
          background: linear-gradient(135deg, #21262d 0%, #30363d 100%);
          color: #a371f7;
        }

        .token-badge.strategy-btn:hover {
          background: linear-gradient(135deg, #30363d 0%, #484f58 100%);
          color: #d2a8ff;
        }

        /* Strategy Modal */
        .strategy-modal {
          width: 90%;
          max-width: 500px;
          max-height: 80vh;
          animation: modalSlideIn 0.2s ease;
        }

        /* Token Modal */
        .modal-overlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }

        .token-modal {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 16px;
          width: 90%;
          max-width: 480px;
          max-height: 70vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 25px 50px rgba(0, 0, 0, 0.5);
          animation: modalSlideIn 0.2s ease;
        }

        @keyframes modalSlideIn {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(-10px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid #21262d;
        }

        .modal-header h3 {
          color: #f0f6fc;
          font-size: 16px;
          font-weight: 600;
          margin: 0;
        }

        .modal-close {
          background: none;
          border: none;
          color: #8b949e;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
          transition: color 0.15s ease;
        }

        .modal-close:hover {
          color: #f0f6fc;
        }

        .modal-search {
          padding: 12px 16px;
          border-bottom: 1px solid #21262d;
        }

        .modal-search input {
          width: 100%;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 8px;
          padding: 10px 14px;
          color: #f0f6fc;
          font-size: 14px;
          font-family: inherit;
          outline: none;
        }

        .modal-search input:focus {
          border-color: #58a6ff;
        }

        .modal-search input::placeholder {
          color: #484f58;
        }

        .token-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .token-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 12px;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .token-item:hover {
          background: #21262d;
        }

        .token-icon {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: #30363d;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
        }

        .token-icon img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .token-icon span {
          color: #8b949e;
          font-size: 11px;
          font-weight: 600;
        }

        .token-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .token-symbol {
          color: #f0f6fc;
          font-size: 14px;
          font-weight: 600;
        }

        .token-name {
          color: #8b949e;
          font-size: 12px;
        }

        .wallet-badge {
          background: rgba(139, 148, 158, 0.15);
          color: #8b949e;
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
        }

        .wallet-badge.connected {
          background: rgba(63, 185, 80, 0.15);
          color: #3fb950;
        }

        /* Scrollbar */
        .terminal-body::-webkit-scrollbar {
          width: 8px;
        }

        .terminal-body::-webkit-scrollbar-track {
          background: #0d1117;
        }

        .terminal-body::-webkit-scrollbar-thumb {
          background: #30363d;
          border-radius: 4px;
        }

        .terminal-body::-webkit-scrollbar-thumb:hover {
          background: #484f58;
        }
      `}</style>
    </div>
  );
}
