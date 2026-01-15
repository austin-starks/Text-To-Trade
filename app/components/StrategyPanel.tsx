"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { Strategy, BaseCondition, Indicator, StrategyAction, ComparisonOperator } from "../types/strategy";
import { useStrategies } from "../contexts/StrategyContext";
import { formatCondition, formatAction } from "../lib/strategy-executor";

interface StrategyPanelProps {
  onClose: () => void;
}

type CreateMode = "ai" | "manual";

// Helper to format cooldown duration
function formatCooldown(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) return `${Math.round(ms / (60 * 1000))} minutes`;
  if (hours === 1) return "1 hour";
  if (hours < 24) return `${hours} hours`;
  if (hours === 24) return "1 day";
  return `${Math.round(hours / 24)} days`;
}

// Helper to format time ago
function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export default function StrategyPanel({ onClose }: StrategyPanelProps) {
  const { address, isConnected } = useAccount();
  const { strategies, addStrategy, updateStrategy, removeStrategy, pauseStrategy, resumeStrategy, evaluations } = useStrategies();
  const [input, setInput] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>("ai");
  
  // Manual form state
  const [manualName, setManualName] = useState("");
  const [manualToken, setManualToken] = useState("ETH");
  const [manualComparison, setManualComparison] = useState<ComparisonOperator>("less_than");
  const [manualPrice, setManualPrice] = useState("");
  const [manualActionType, setManualActionType] = useState<"swap" | "alert">("swap");
  const [manualSellToken, setManualSellToken] = useState("USDC");
  const [manualBuyToken, setManualBuyToken] = useState("ETH");
  const [manualSellPercentage, setManualSellPercentage] = useState("10");
  const [manualAlertMessage, setManualAlertMessage] = useState("");
  const [manualIsRecurring, setManualIsRecurring] = useState(false);
  const [manualCooldownHours, setManualCooldownHours] = useState("4");

  // Filter strategies for current user
  const userStrategies = strategies.filter(
    (s) => s.ownerAddress.toLowerCase() === address?.toLowerCase()
  );

  const handleCreateStrategy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !address) return;

    setIsCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/create-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: input.trim(),
          ownerAddress: address,
        }),
      });

      const data = await response.json();

      if (!data.success) {
        setError(data.error || "Failed to create strategy");
        return;
      }

      // Add strategy with proper date hydration
      const strategy: Strategy = {
        ...data.strategy,
        createdAt: new Date(data.strategy.createdAt),
      };
      
      addStrategy(strategy);
      setInput("");
      setShowCreateForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create strategy");
    } finally {
      setIsCreating(false);
    }
  };

  const handleManualCreate = () => {
    if (!address || !manualPrice) return;

    const priceValue = parseFloat(manualPrice);
    if (isNaN(priceValue)) {
      setError("Invalid price value");
      return;
    }

    const lhs: Indicator = { type: "price", token: manualToken, value: undefined };
    const rhs: Indicator = { type: "constant", token: undefined, value: priceValue };

    const condition: BaseCondition = {
      type: "base",
      lhs,
      rhs,
      comparison: manualComparison,
    };

    let action: StrategyAction;
    if (manualActionType === "swap") {
      action = {
        type: "swap",
        sellToken: manualSellToken,
        buyToken: manualBuyToken,
        sellPercentage: parseFloat(manualSellPercentage) || 10,
      };
    } else {
      action = {
        type: "alert",
        message: manualAlertMessage || `${manualToken} price ${manualComparison.replace("_", " ")} $${manualPrice}`,
      };
    }

    const comparisonText = manualComparison === "less_than" ? "below" : 
                          manualComparison === "greater_than" ? "above" : 
                          manualComparison.replace(/_/g, " ");

    const strategy: Strategy = {
      id: crypto.randomUUID(),
      name: manualName || `${manualToken} ${comparisonText} $${manualPrice}`,
      description: `Trigger when ${manualToken} price is ${comparisonText} $${priceValue.toLocaleString()}`,
      condition,
      action,
      status: "active",
      createdAt: new Date(),
      executionCount: 0,
      maxExecutions: manualIsRecurring ? 0 : 1,
      isRecurring: manualIsRecurring,
      cooldownMs: manualIsRecurring ? parseFloat(manualCooldownHours) * 60 * 60 * 1000 : 0,
      ownerAddress: address,
    };

    addStrategy(strategy);
    resetManualForm();
    setShowCreateForm(false);
  };

  const resetManualForm = () => {
    setManualName("");
    setManualToken("ETH");
    setManualComparison("less_than");
    setManualPrice("");
    setManualActionType("swap");
    setManualSellToken("USDC");
    setManualBuyToken("ETH");
    setManualSellPercentage("10");
    setManualAlertMessage("");
    setManualIsRecurring(false);
    setManualCooldownHours("4");
    setError(null);
  };

  const getStatusColor = (status: Strategy["status"]) => {
    switch (status) {
      case "active": return "#3fb950";
      case "paused": return "#8b949e";
      case "triggered": return "#a371f7";
      case "expired": return "#6e7681";
      case "failed": return "#f85149";
      default: return "#8b949e";
    }
  };

  const getStatusIcon = (status: Strategy["status"]) => {
    switch (status) {
      case "active": return "●";
      case "paused": return "⏸";
      case "triggered": return "✓";
      case "expired": return "○";
      case "failed": return "✗";
      default: return "?";
    }
  };

  return (
    <div className="strategy-panel">
      <div className="panel-header">
        <h2>📊 Trading Strategies</h2>
        <button className="close-btn" onClick={onClose}>×</button>
      </div>

      {!isConnected ? (
        <div className="panel-empty">
          <p>Connect your wallet to create and view strategies</p>
        </div>
      ) : (
        <>
          {/* Strategy List */}
          <div className="strategy-list">
            {userStrategies.length === 0 ? (
              <div className="panel-empty">
                <p>No strategies yet</p>
                <p className="hint">Create your first automated trading strategy</p>
              </div>
            ) : (
              userStrategies.map((strategy) => (
                <StrategyCard
                  key={strategy.id}
                  strategy={strategy}
                  evaluation={evaluations.get(strategy.id)}
                  onPause={() => pauseStrategy(strategy.id)}
                  onResume={() => resumeStrategy(strategy.id)}
                  onDelete={() => removeStrategy(strategy.id)}
                  onUpdate={(updates) => updateStrategy(strategy.id, updates)}
                />
              ))
            )}
          </div>

          {/* Create Strategy */}
          {showCreateForm ? (
            <div className="create-form">
              <div className="form-header">
                <span>Create Strategy</span>
                <button 
                  type="button" 
                  className="cancel-btn"
                  onClick={() => { setShowCreateForm(false); resetManualForm(); }}
                >
                  Cancel
                </button>
              </div>
              
              {/* Mode Toggle */}
              <div className="mode-toggle">
                <button 
                  className={`mode-btn ${createMode === "ai" ? "active" : ""}`}
                  onClick={() => setCreateMode("ai")}
                >
                  🤖 AI Parse
                </button>
                <button 
                  className={`mode-btn ${createMode === "manual" ? "active" : ""}`}
                  onClick={() => setCreateMode("manual")}
                >
                  ⚙️ Manual
                </button>
              </div>

              {createMode === "ai" ? (
                <form onSubmit={handleCreateStrategy}>
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Describe your strategy in plain English...&#10;&#10;Examples:&#10;• Buy ETH when it drops below $3000&#10;• Sell 50% of my DEGEN when it goes above $0.02&#10;• Alert me when cbBTC falls below $90,000"
                    rows={4}
                    disabled={isCreating}
                  />
                  {error && <div className="form-error">{error}</div>}
                  <button 
                    type="submit" 
                    className="submit-btn"
                    disabled={isCreating || !input.trim()}
                  >
                    {isCreating ? "Creating..." : "⚡ Create Strategy"}
                  </button>
                </form>
              ) : (
                <div className="manual-form">
                  {/* Strategy Name */}
                  <div className="form-group">
                    <label>Name (optional)</label>
                    <input
                      type="text"
                      value={manualName}
                      onChange={(e) => setManualName(e.target.value)}
                      placeholder="e.g., Buy the dip"
                    />
                  </div>

                  {/* Condition */}
                  <div className="form-section">
                    <label className="section-label">When...</label>
                    <div className="condition-row">
                      <input
                        type="text"
                        value={manualToken}
                        onChange={(e) => setManualToken(e.target.value.toUpperCase())}
                        placeholder="ETH"
                        className="token-input"
                      />
                      <span className="label-text">price is</span>
                      <select
                        value={manualComparison}
                        onChange={(e) => setManualComparison(e.target.value as ComparisonOperator)}
                      >
                        <option value="less_than">below</option>
                        <option value="greater_than">above</option>
                        <option value="less_than_or_equal">at or below</option>
                        <option value="greater_than_or_equal">at or above</option>
                      </select>
                      <span className="label-text">$</span>
                      <input
                        type="number"
                        value={manualPrice}
                        onChange={(e) => setManualPrice(e.target.value)}
                        placeholder="3000"
                        className="price-input"
                        step="any"
                      />
                    </div>
                  </div>

                  {/* Action */}
                  <div className="form-section">
                    <label className="section-label">Then...</label>
                    <div className="action-type-toggle">
                      <button
                        type="button"
                        className={`action-type-btn ${manualActionType === "swap" ? "active" : ""}`}
                        onClick={() => setManualActionType("swap")}
                      >
                        💱 Swap
                      </button>
                      <button
                        type="button"
                        className={`action-type-btn ${manualActionType === "alert" ? "active" : ""}`}
                        onClick={() => setManualActionType("alert")}
                      >
                        🔔 Alert
                      </button>
                    </div>

                    {manualActionType === "swap" ? (
                      <div className="swap-config">
                        <div className="swap-row">
                          <span className="label-text">Swap</span>
                          <input
                            type="number"
                            value={manualSellPercentage}
                            onChange={(e) => setManualSellPercentage(e.target.value)}
                            className="percent-input"
                            min="1"
                            max="100"
                          />
                          <span className="label-text">% of</span>
                          <input
                            type="text"
                            value={manualSellToken}
                            onChange={(e) => setManualSellToken(e.target.value.toUpperCase())}
                            className="token-input"
                            placeholder="USDC"
                          />
                          <span className="label-text">→</span>
                          <input
                            type="text"
                            value={manualBuyToken}
                            onChange={(e) => setManualBuyToken(e.target.value.toUpperCase())}
                            className="token-input"
                            placeholder="ETH"
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="alert-config">
                        <input
                          type="text"
                          value={manualAlertMessage}
                          onChange={(e) => setManualAlertMessage(e.target.value)}
                          placeholder="Alert message (optional)"
                        />
                      </div>
                    )}
                  </div>

                  {/* Recurring Options */}
                  <div className="form-section">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={manualIsRecurring}
                        onChange={(e) => setManualIsRecurring(e.target.checked)}
                      />
                      <span>Recurring (trigger multiple times)</span>
                    </label>
                    {manualIsRecurring && (
                      <div className="cooldown-row">
                        <span className="label-text">Cooldown:</span>
                        <input
                          type="number"
                          value={manualCooldownHours}
                          onChange={(e) => setManualCooldownHours(e.target.value)}
                          className="cooldown-input"
                          min="0.5"
                          step="0.5"
                        />
                        <span className="label-text">hours</span>
                      </div>
                    )}
                  </div>

                  {error && <div className="form-error">{error}</div>}
                  <button 
                    type="button"
                    className="submit-btn"
                    onClick={handleManualCreate}
                    disabled={!manualPrice}
                  >
                    ⚡ Create Strategy
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button 
              className="add-strategy-btn"
              onClick={() => setShowCreateForm(true)}
            >
              + Add Strategy
            </button>
          )}
        </>
      )}

      <style jsx>{`
        .strategy-panel {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 12px;
          overflow: hidden;
          max-height: 500px;
          display: flex;
          flex-direction: column;
        }

        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          background: #161b22;
          border-bottom: 1px solid #21262d;
        }

        .panel-header h2 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: #f0f6fc;
        }

        .close-btn {
          background: none;
          border: none;
          color: #8b949e;
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        }

        .close-btn:hover {
          color: #f0f6fc;
        }

        .panel-empty {
          padding: 32px 16px;
          text-align: center;
          color: #8b949e;
        }

        .panel-empty .hint {
          font-size: 13px;
          margin-top: 8px;
          color: #6e7681;
        }

        .strategy-list {
          flex: 1;
          overflow-y: auto;
          padding: 8px;
        }

        .add-strategy-btn {
          margin: 12px;
          padding: 12px;
          background: #21262d;
          border: 1px dashed #30363d;
          border-radius: 8px;
          color: #8b949e;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .add-strategy-btn:hover {
          background: #30363d;
          border-color: #58a6ff;
          color: #58a6ff;
        }

        .create-form {
          padding: 12px;
          border-top: 1px solid #21262d;
          background: #161b22;
        }

        .form-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          color: #f0f6fc;
          font-weight: 500;
        }

        .cancel-btn {
          background: none;
          border: none;
          color: #8b949e;
          font-size: 13px;
          cursor: pointer;
        }

        .cancel-btn:hover {
          color: #f85149;
        }

        .create-form textarea {
          width: 100%;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 8px;
          padding: 12px;
          color: #f0f6fc;
          font-size: 14px;
          font-family: inherit;
          resize: none;
          outline: none;
        }

        .create-form textarea:focus {
          border-color: #58a6ff;
        }

        .create-form textarea::placeholder {
          color: #484f58;
        }

        .form-error {
          color: #f85149;
          font-size: 13px;
          margin-top: 8px;
          padding: 8px;
          background: rgba(248, 81, 73, 0.1);
          border-radius: 4px;
        }

        .submit-btn {
          width: 100%;
          margin-top: 12px;
          padding: 12px;
          background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
          border: none;
          border-radius: 8px;
          color: #ffffff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .submit-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #2ea043 0%, #3fb950 100%);
        }

        .submit-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .mode-toggle {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
        }

        .mode-btn {
          flex: 1;
          padding: 8px;
          background: #21262d;
          border: 1px solid #30363d;
          border-radius: 6px;
          color: #8b949e;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .mode-btn.active {
          background: #388bfd20;
          border-color: #58a6ff;
          color: #58a6ff;
        }

        .mode-btn:hover:not(.active) {
          background: #30363d;
        }

        .manual-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .form-group label {
          font-size: 12px;
          color: #8b949e;
        }

        .form-group input {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 8px 10px;
          color: #f0f6fc;
          font-size: 13px;
        }

        .form-group input:focus {
          border-color: #58a6ff;
          outline: none;
        }

        .form-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .section-label {
          font-size: 12px;
          color: #58a6ff;
          font-weight: 500;
        }

        .condition-row,
        .swap-row,
        .cooldown-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .label-text {
          font-size: 13px;
          color: #8b949e;
        }

        .token-input {
          width: 70px;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 6px 8px;
          color: #f0f6fc;
          font-size: 13px;
          text-transform: uppercase;
        }

        .price-input {
          width: 100px;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 6px 8px;
          color: #f0f6fc;
          font-size: 13px;
        }

        .percent-input {
          width: 60px;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 6px 8px;
          color: #f0f6fc;
          font-size: 13px;
        }

        .cooldown-input {
          width: 60px;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 6px 8px;
          color: #f0f6fc;
          font-size: 13px;
        }

        .form-section select {
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 6px 8px;
          color: #f0f6fc;
          font-size: 13px;
        }

        .action-type-toggle {
          display: flex;
          gap: 8px;
        }

        .action-type-btn {
          flex: 1;
          padding: 8px;
          background: #21262d;
          border: 1px solid #30363d;
          border-radius: 6px;
          color: #8b949e;
          font-size: 12px;
          cursor: pointer;
        }

        .action-type-btn.active {
          background: #238636;
          border-color: #238636;
          color: #ffffff;
        }

        .swap-config,
        .alert-config {
          margin-top: 8px;
        }

        .alert-config input {
          width: 100%;
          background: #0d1117;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 8px 10px;
          color: #f0f6fc;
          font-size: 13px;
        }

        .checkbox-label {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
          color: #f0f6fc;
          cursor: pointer;
        }

        .checkbox-label input[type="checkbox"] {
          width: 16px;
          height: 16px;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// Individual Strategy Card Component
function StrategyCard({
  strategy,
  evaluation,
  onPause,
  onResume,
  onDelete,
  onUpdate,
}: {
  strategy: Strategy;
  evaluation?: { conditionMet: boolean; currentValues: { lhs?: number; rhs?: number } };
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
  onUpdate: (updates: Partial<Strategy>) => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // Edit form state
  const [editPrice, setEditPrice] = useState("");
  const [editSellPercentage, setEditSellPercentage] = useState("");
  const [editIsRecurring, setEditIsRecurring] = useState(false);
  const [editCooldownHours, setEditCooldownHours] = useState("");

  // Initialize edit form when entering edit mode
  const startEditing = () => {
    // Get current price from condition
    if (strategy.condition.type === "base") {
      const baseCondition = strategy.condition as BaseCondition;
      if (baseCondition.rhs?.type === "constant" && baseCondition.rhs.value !== null && baseCondition.rhs.value !== undefined) {
        setEditPrice(baseCondition.rhs.value.toString());
      }
    }
    // Get sell percentage from action
    if (strategy.action.type === "swap" && strategy.action.sellPercentage) {
      setEditSellPercentage(strategy.action.sellPercentage.toString());
    }
    setEditIsRecurring(strategy.isRecurring || false);
    setEditCooldownHours(((strategy.cooldownMs || 0) / (60 * 60 * 1000)).toString());
    setIsEditing(true);
    setShowDetails(true);
  };

  const saveEdits = () => {
    const updates: Partial<Strategy> = {};
    
    // Update price in condition
    const newPrice = parseFloat(editPrice);
    if (!isNaN(newPrice) && strategy.condition.type === "base") {
      const oldCondition = strategy.condition as BaseCondition;
      updates.condition = {
        ...oldCondition,
        rhs: { ...oldCondition.rhs, value: newPrice },
      } as BaseCondition;
    }

    // Update sell percentage in action
    if (strategy.action.type === "swap" && editSellPercentage) {
      const newPercentage = parseFloat(editSellPercentage);
      if (!isNaN(newPercentage)) {
        updates.action = {
          ...strategy.action,
          sellPercentage: newPercentage,
        };
      }
    }

    // Update recurring settings
    updates.isRecurring = editIsRecurring;
    updates.maxExecutions = editIsRecurring ? 0 : 1;
    updates.cooldownMs = editIsRecurring ? parseFloat(editCooldownHours) * 60 * 60 * 1000 : 0;

    onUpdate(updates);
    setIsEditing(false);
  };

  const cancelEditing = () => {
    setIsEditing(false);
  };

  // Check if strategy is in cooldown
  const getCooldownStatus = (s: Strategy): string | null => {
    if (!s.isRecurring || !s.lastTriggeredAt || !s.cooldownMs) return null;
    
    const now = Date.now();
    const cooldownEnds = new Date(s.lastTriggeredAt).getTime() + s.cooldownMs;
    const remainingMs = cooldownEnds - now;
    
    if (remainingMs <= 0) return null;
    
    const remainingHours = Math.ceil(remainingMs / (60 * 60 * 1000));
    if (remainingHours < 1) {
      const remainingMins = Math.ceil(remainingMs / (60 * 1000));
      return `⏳ ${remainingMins}m`;
    }
    return `⏳ ${remainingHours}h`;
  };

  const getStatusColor = (status: Strategy["status"]) => {
    switch (status) {
      case "active": return "#3fb950";
      case "paused": return "#8b949e";
      case "triggered": return "#a371f7";
      case "expired": return "#6e7681";
      case "failed": return "#f85149";
      default: return "#8b949e";
    }
  };

  return (
    <div className="strategy-card">
      <div className="card-header" onClick={() => setShowDetails(!showDetails)}>
        <div className="card-status">
          <span 
            className="status-dot" 
            style={{ background: getStatusColor(strategy.status) }}
          />
          <span className="status-text">{strategy.status}</span>
        </div>
        <span className="card-name">
          {strategy.isRecurring && <span className="recurring-badge">🔄</span>}
          {strategy.name}
        </span>
        {getCooldownStatus(strategy) && (
          <span className="cooldown-badge">{getCooldownStatus(strategy)}</span>
        )}
        <span className="expand-icon">{showDetails ? "▼" : "▶"}</span>
      </div>

      <div className="card-summary">
        <div className="condition-preview">
          <span className="label">IF</span>
          <span className="value">{formatCondition(strategy.condition)}</span>
        </div>
        <div className="action-preview">
          <span className="label">THEN</span>
          <span className="value">{formatAction(strategy.action)}</span>
        </div>
      </div>

      {showDetails && (
        <div className="card-details">
          {isEditing ? (
            <div className="edit-form">
              {/* Edit Price */}
              {strategy.condition.type === "base" && (
                <div className="edit-row">
                  <label>Target Price ($)</label>
                  <input
                    type="number"
                    value={editPrice}
                    onChange={(e) => setEditPrice(e.target.value)}
                    step="any"
                  />
                </div>
              )}
              
              {/* Edit Sell Percentage */}
              {strategy.action.type === "swap" && (
                <div className="edit-row">
                  <label>Sell Percentage (%)</label>
                  <input
                    type="number"
                    value={editSellPercentage}
                    onChange={(e) => setEditSellPercentage(e.target.value)}
                    min="1"
                    max="100"
                  />
                </div>
              )}

              {/* Recurring Toggle */}
              <div className="edit-row">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editIsRecurring}
                    onChange={(e) => setEditIsRecurring(e.target.checked)}
                  />
                  <span>Recurring</span>
                </label>
              </div>

              {/* Cooldown */}
              {editIsRecurring && (
                <div className="edit-row">
                  <label>Cooldown (hours)</label>
                  <input
                    type="number"
                    value={editCooldownHours}
                    onChange={(e) => setEditCooldownHours(e.target.value)}
                    min="0.5"
                    step="0.5"
                  />
                </div>
              )}

              <div className="edit-actions">
                <button className="action-btn save" onClick={saveEdits}>
                  ✓ Save
                </button>
                <button className="action-btn cancel" onClick={cancelEditing}>
                  ✗ Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="detail-row">
                <span className="detail-label">Description</span>
                <span className="detail-value">{strategy.description}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Created</span>
                <span className="detail-value">
                  {new Date(strategy.createdAt).toLocaleDateString()}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Type</span>
                <span className="detail-value">
                  {strategy.isRecurring ? "🔄 Recurring" : "1️⃣ One-time"}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-label">Executions</span>
                <span className="detail-value">
                  {strategy.executionCount} / {strategy.maxExecutions === 0 ? "∞" : strategy.maxExecutions}
                </span>
              </div>
              {strategy.isRecurring && strategy.cooldownMs > 0 && (
                <div className="detail-row">
                  <span className="detail-label">Cooldown</span>
                  <span className="detail-value">
                    {formatCooldown(strategy.cooldownMs)}
                  </span>
                </div>
              )}
              {strategy.lastTriggeredAt && (
                <div className="detail-row">
                  <span className="detail-label">Last Triggered</span>
                  <span className="detail-value">
                    {formatTimeAgo(new Date(strategy.lastTriggeredAt))}
                  </span>
                </div>
              )}
              {evaluation?.currentValues?.lhs !== undefined && (
                <div className="detail-row">
                  <span className="detail-label">Current Value</span>
                  <span className="detail-value">
                    ${evaluation.currentValues.lhs?.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="card-actions">
                <button className="action-btn edit" onClick={startEditing}>
                  ✏️ Edit
                </button>
                {strategy.status === "active" ? (
                  <button className="action-btn pause" onClick={onPause}>
                    ⏸ Pause
                  </button>
                ) : strategy.status === "paused" ? (
                  <button className="action-btn resume" onClick={onResume}>
                    ▶ Resume
                  </button>
                ) : null}
                <button className="action-btn delete" onClick={onDelete}>
                  🗑 Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <style jsx>{`
        .strategy-card {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 8px;
          margin-bottom: 8px;
          overflow: hidden;
        }

        .card-header {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px;
          cursor: pointer;
          transition: background 0.15s ease;
        }

        .card-header:hover {
          background: #21262d;
        }

        .card-status {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
        }

        .status-text {
          font-size: 11px;
          text-transform: uppercase;
          color: #8b949e;
        }

        .card-name {
          flex: 1;
          font-size: 14px;
          font-weight: 500;
          color: #f0f6fc;
        }

        .expand-icon {
          color: #6e7681;
          font-size: 10px;
        }

        .recurring-badge {
          margin-right: 6px;
        }

        .cooldown-badge {
          font-size: 11px;
          padding: 2px 6px;
          background: rgba(136, 136, 136, 0.2);
          border-radius: 4px;
          color: #8b949e;
        }

        .card-summary {
          padding: 0 12px 12px;
          font-size: 12px;
        }

        .condition-preview,
        .action-preview {
          display: flex;
          gap: 8px;
          margin-top: 4px;
        }

        .label {
          color: #6e7681;
          font-weight: 500;
          min-width: 40px;
        }

        .condition-preview .value {
          color: #79c0ff;
        }

        .action-preview .value {
          color: #7ee787;
        }

        .card-details {
          padding: 12px;
          background: #0d1117;
          border-top: 1px solid #21262d;
        }

        .detail-row {
          display: flex;
          justify-content: space-between;
          padding: 6px 0;
          font-size: 13px;
        }

        .detail-label {
          color: #8b949e;
        }

        .detail-value {
          color: #f0f6fc;
        }

        .card-actions {
          display: flex;
          gap: 8px;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #21262d;
        }

        .action-btn {
          flex: 1;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
        }

        .action-btn.pause {
          background: #21262d;
          border: 1px solid #30363d;
          color: #f0883e;
        }

        .action-btn.pause:hover {
          background: #30363d;
        }

        .action-btn.resume {
          background: #21262d;
          border: 1px solid #30363d;
          color: #3fb950;
        }

        .action-btn.resume:hover {
          background: #30363d;
        }

        .action-btn.delete {
          background: transparent;
          border: 1px solid #30363d;
          color: #f85149;
        }

        .action-btn.delete:hover {
          background: rgba(248, 81, 73, 0.1);
        }

        .action-btn.edit {
          background: #21262d;
          border: 1px solid #30363d;
          color: #58a6ff;
        }

        .action-btn.edit:hover {
          background: rgba(88, 166, 255, 0.1);
        }

        .action-btn.save {
          background: #238636;
          border: 1px solid #238636;
          color: #ffffff;
        }

        .action-btn.save:hover {
          background: #2ea043;
        }

        .action-btn.cancel {
          background: #21262d;
          border: 1px solid #30363d;
          color: #8b949e;
        }

        .action-btn.cancel:hover {
          background: #30363d;
        }

        .edit-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .edit-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .edit-row label {
          font-size: 12px;
          color: #8b949e;
        }

        .edit-row input[type="number"],
        .edit-row input[type="text"] {
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 6px;
          padding: 8px 10px;
          color: #f0f6fc;
          font-size: 13px;
          width: 100%;
        }

        .edit-row input:focus {
          border-color: #58a6ff;
          outline: none;
        }

        .edit-actions {
          display: flex;
          gap: 8px;
          margin-top: 8px;
        }
      `}</style>
    </div>
  );
}

