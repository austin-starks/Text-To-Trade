"use client";


import { useState, useRef, useEffect } from "react";
import { useAccount, useSendTransaction, useWaitForTransactionReceipt, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { parseUnits, formatUnits } from "viem";
import { SUPPORTED_NETWORKS, SupportedChainId } from "../config";
import { resolveToken, parseTokenAmount } from "../lib/tokens";
import { getMockQuote } from "../lib/inch-api";
import { QuoteResult, TokenInfo } from "../types/order";



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
  const inputRef = useRef<HTMLInputElement>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);
  const networkMenuRef = useRef<HTMLDivElement>(null);

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
  const { isLoading: isConfirming, isSuccess: isTxSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  // Handle successful transaction
  useEffect(() => {
    if (isTxSuccess && txHash) {
      addToHistory("success", `✅ Transaction confirmed! Hash: ${txHash.slice(0, 10)}...${txHash.slice(-8)}`);
      setPendingTrade(null);
      setTxHash(undefined);
    }
  }, [isTxSuccess, txHash]);

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
      // Call the LLM API to parse the order
      const response = await fetch("/api/parse-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: userInput }),
      });

      const data = await response.json();

      // Remove thinking message
      setHistory((prev) => prev.filter((h) => h.type !== "thinking"));

      if (!data.success || !data.order) {
        addToHistory("error", data.error || "Could not understand that trade request");
        setIsProcessing(false);
        return;
      }

      const order: LLMParsedOrder = data.order;

      // Show confidence and reasoning
      const confidenceEmoji = order.confidence >= 0.8 ? "🟢" : order.confidence >= 0.5 ? "🟡" : "🔴";
      addToHistory(
        "parsed",
        `${confidenceEmoji} Parsed: ${order.action.toUpperCase()} ${order.sellAmount || "?"} ${order.sellToken} → ${order.buyToken}`
      );

      if (order.reasoning) {
        addToHistory("parsed", `AI: ${order.reasoning}`);
      }

      // Validate tokens exist
      const sellToken = resolveToken(order.sellToken);
      const buyToken = resolveToken(order.buyToken);

      if (!sellToken || !buyToken) {
        addToHistory("error", `Token not found: ${!sellToken ? order.sellToken : order.buyToken}`);
        setIsProcessing(false);
        return;
      }

      // Calculate sell amount
      let sellAmountWei: string;

      if (order.sellAmount && order.sellAmount !== "") {
        sellAmountWei = parseTokenAmount(order.sellAmount, sellToken.decimals);
      } else if (order.buyAmount && order.buyAmount !== "") {
        // Estimate sell amount based on mock prices
        const mockPrices: Record<string, number> = {
          ETH: 3200, WETH: 3200, USDC: 1, USDT: 1, DAI: 1,
          DEGEN: 0.008, BRETT: 0.12, AERO: 1.2, cbBTC: 95000,
          VIRTUAL: 2.5, TOSHI: 0.0003,
        };
        const buyPrice = mockPrices[buyToken.symbol] || 1;
        const sellPrice = mockPrices[sellToken.symbol] || 1;
        const buyAmountNum = Number(order.buyAmount);
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

  const handleConfirmTrade = async () => {
    if (!pendingTrade || !address) {
      addToHistory("error", "Please connect your wallet first");
      return;
    }

    addToHistory("thinking", "Preparing transaction...");

    try {
      // Call swap API to get transaction data
      const response = await fetch("/api/swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          src: pendingTrade.sellToken.address,
          dst: pendingTrade.buyToken.address,
          amount: pendingTrade.sellAmountWei,
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

      // Execute the transaction
      addToHistory("thinking", "Confirm in your wallet...");

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
            addToHistory("success", `📤 Transaction sent! Waiting for confirmation...`);
          },
          onError: (error) => {
            setHistory((prev) => prev.filter((h) => h.type !== "thinking"));
            addToHistory("error", `Transaction failed: ${error.message}`);
          },
        }
      );

    } catch (error) {
      setHistory((prev) => prev.filter((h) => h.type !== "thinking"));
      addToHistory("error", error instanceof Error ? error.message : "Failed to execute swap");
    }
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
              {Object.entries(SUPPORTED_NETWORKS).map(([id, network]) => (
                <button
                  key={id}
                  className={`network-option ${Number(id) === currentChainId ? "active" : ""}`}
                  onClick={() => handleNetworkSwitch(Number(id) as SupportedChainId)}
                >
                  <span
                    className="option-dot"
                    style={{ background: network.color }}
                  ></span>
                  {network.name}
                  {Number(id) === currentChainId && <span className="check">✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

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
                className="confirm-btn execute"
                onClick={handleConfirmTrade}
                disabled={isSending || isConfirming || !isConnected}
              >
                {!isConnected
                  ? "Connect Wallet"
                  : isSending
                  ? "Confirm in Wallet..."
                  : isConfirming
                  ? "Confirming..."
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
      <div className="terminal-footer">
        <div className="footer-left">
          <span className="token-badge">ETH</span>
          <span className="token-badge">USDC</span>
          <span className="token-badge">DEGEN</span>
          <span className="token-badge">+8 more</span>
        </div>
        <div className="footer-right">
          {isConnected ? (
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
