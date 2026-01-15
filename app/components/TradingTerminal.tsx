"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { base } from "wagmi/chains";
import { SUPPORTED_NETWORKS, SupportedChainId } from "../config";
import { getMockQuote } from "../lib/inch-api";
import { parseOrderInput, ParseResult } from "../lib/order-parser";
import { parseTokenAmount, resolveToken } from "../lib/tokens";
import { ParsedOrder, QuoteResult } from "../types/order";

interface HistoryEntry {
  id: string;
  type: "input" | "parsed" | "quote" | "error";
  content: string;
  timestamp: Date;
  data?: ParsedOrder | QuoteResult | ParseResult;
}

export default function TradingTerminal() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
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

  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const addToHistory = (
    type: HistoryEntry["type"],
    content: string,
    data?: HistoryEntry["data"]
  ) => {
    setHistory((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type,
        content,
        timestamp: new Date(),
        data,
      },
    ]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userInput = input.trim();
    setInput("");
    setIsProcessing(true);

    // Add user input to history
    addToHistory("input", userInput);

    // Parse the input
    const parseResult = parseOrderInput(userInput);

    if (!parseResult.success) {
      addToHistory("error", parseResult.error || "Unknown error", parseResult);
      if (parseResult.suggestions?.length) {
        addToHistory(
          "error",
          `Try: ${parseResult.suggestions.join(" | ")}`
        );
      }
      setIsProcessing(false);
      return;
    }

    const order = parseResult.order!;
    addToHistory(
      "parsed",
      `Parsed: ${order.action.toUpperCase()} ${order.sellAmount || "?"} ${order.sellToken} → ${order.buyToken}`,
      order
    );

    // Get quote
    const sellToken = resolveToken(order.sellToken)!;
    const buyToken = resolveToken(order.buyToken)!;

    try {
      let sellAmountWei: string;

      if (order.sellAmount) {
        // Direct sell amount specified
        sellAmountWei = parseTokenAmount(order.sellAmount, sellToken.decimals);
      } else if (order.buyAmount) {
        // "buy X ETH" - estimate sell amount based on mock prices
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
        
        addToHistory(
          "parsed",
          `Estimated: ~${estimatedSellAmount.toFixed(2)} ${sellToken.symbol} needed`
        );
      } else {
        addToHistory("error", "Need an amount to get a quote");
        setIsProcessing(false);
        return;
      }

      // Using mock quote for development (no API key needed)
      // Replace with real 1inch API call when you have a key
      const quote = getMockQuote(sellToken, buyToken, sellAmountWei);

      addToHistory(
        "quote",
        `Quote: ${quote.sellAmountDisplay} ${quote.sellToken.symbol} → ${quote.buyAmountDisplay} ${quote.buyToken.symbol}`,
        quote
      );
      addToHistory(
        "quote",
        `Route: ${quote.protocols.join(" → ")} | Gas: ~${Number(quote.estimatedGas).toLocaleString()}`
      );
    } catch {
      addToHistory("error", "Failed to fetch quote. Please try again.");
    }

    setIsProcessing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setInput("");
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
              <div className="example-label">Examples:</div>
              <button
                className="example-btn"
                onClick={() => setInput("swap 100 USDC for ETH")}
              >
                swap 100 USDC for ETH
              </button>
              <button
                className="example-btn"
                onClick={() => setInput("buy 0.05 ETH with USDC")}
              >
                buy 0.05 ETH with USDC
              </button>
              <button
                className="example-btn"
                onClick={() => setInput("sell 10000 DEGEN for USDC")}
              >
                sell 10000 DEGEN for USDC
              </button>
              <button
                className="example-btn"
                onClick={() => setInput("50 USDC to BRETT")}
              >
                50 USDC to BRETT
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
              </span>
              <span className="entry-content">{entry.content}</span>
            </div>
          ))}
          <div ref={historyEndRef} />
        </div>

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
          <span className="mode-badge">Preview Mode</span>
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

        .mode-badge {
          background: rgba(163, 113, 247, 0.15);
          color: #a371f7;
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
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

