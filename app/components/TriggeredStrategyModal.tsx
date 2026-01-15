"use client";

import { useState } from "react";
import { Strategy } from "../types/strategy";
import { formatCondition, formatAction } from "../lib/strategy-executor";

interface TriggeredStrategyModalProps {
  strategy: Strategy;
  currentValue?: number;
  targetValue?: number;
  onExecute: () => void;
  onDismiss: () => void;
  onSnooze: () => void;
}

export default function TriggeredStrategyModal({
  strategy,
  currentValue,
  targetValue,
  onExecute,
  onDismiss,
  onSnooze,
}: TriggeredStrategyModalProps) {
  const [isExecuting, setIsExecuting] = useState(false);

  const handleExecute = async () => {
    setIsExecuting(true);
    try {
      await onExecute();
    } finally {
      setIsExecuting(false);
    }
  };

  const isSwapAction = strategy.action.type === "swap";
  const timeSinceTriggered = strategy.triggeredAt 
    ? Math.floor((Date.now() - new Date(strategy.triggeredAt).getTime()) / 1000 / 60)
    : 0;

  return (
    <div className="modal-overlay">
      <div className="triggered-modal">
        <div className="modal-header">
          <span className="alert-icon">🔔</span>
          <h2>Strategy Triggered!</h2>
        </div>

        <div className="modal-body">
          <div className="strategy-name">{strategy.name}</div>
          <div className="strategy-description">{strategy.description}</div>

          <div className="condition-box">
            <div className="condition-label">Condition Met</div>
            <div className="condition-value">{formatCondition(strategy.condition)}</div>
            {currentValue !== undefined && targetValue !== undefined && (
              <div className="condition-values">
                <span className="current">Current: ${currentValue.toLocaleString()}</span>
                <span className="target">Target: ${targetValue.toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="action-box">
            <div className="action-label">
              {isSwapAction ? "Ready to Execute" : "Alert"}
            </div>
            <div className="action-value">{formatAction(strategy.action)}</div>
          </div>

          {timeSinceTriggered > 0 && (
            <div className="time-ago">
              Triggered {timeSinceTriggered} minute{timeSinceTriggered !== 1 ? "s" : ""} ago
            </div>
          )}
        </div>

        <div className="modal-actions">
          {isSwapAction ? (
            <>
              <button 
                className="action-btn dismiss" 
                onClick={onDismiss}
                disabled={isExecuting}
              >
                Cancel
              </button>
              <button 
                className="action-btn snooze" 
                onClick={onSnooze}
                disabled={isExecuting}
              >
                ⏰ Snooze 1h
              </button>
              <button 
                className="action-btn execute" 
                onClick={handleExecute}
                disabled={isExecuting}
              >
                {isExecuting ? "Executing..." : "⚡ Execute Trade"}
              </button>
            </>
          ) : (
            <>
              <button 
                className="action-btn snooze" 
                onClick={onSnooze}
              >
                ⏰ Snooze 1h
              </button>
              <button 
                className="action-btn dismiss primary" 
                onClick={onDismiss}
              >
                Got it!
              </button>
            </>
          )}
        </div>

        <style jsx>{`
          .modal-overlay {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 2000;
            backdrop-filter: blur(4px);
          }

          .triggered-modal {
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 16px;
            width: 90%;
            max-width: 420px;
            overflow: hidden;
            box-shadow: 
              0 0 0 1px rgba(163, 113, 247, 0.2),
              0 25px 50px rgba(0, 0, 0, 0.5),
              0 0 80px rgba(163, 113, 247, 0.1);
            animation: modalPop 0.3s ease;
          }

          @keyframes modalPop {
            from {
              opacity: 0;
              transform: scale(0.9) translateY(-20px);
            }
            to {
              opacity: 1;
              transform: scale(1) translateY(0);
            }
          }

          .modal-header {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 20px;
            background: linear-gradient(135deg, rgba(163, 113, 247, 0.15) 0%, rgba(163, 113, 247, 0.05) 100%);
            border-bottom: 1px solid rgba(163, 113, 247, 0.2);
          }

          .alert-icon {
            font-size: 28px;
            animation: ring 0.5s ease-in-out;
          }

          @keyframes ring {
            0%, 100% { transform: rotate(0deg); }
            25% { transform: rotate(15deg); }
            75% { transform: rotate(-15deg); }
          }

          .modal-header h2 {
            margin: 0;
            font-size: 18px;
            font-weight: 600;
            color: #d2a8ff;
          }

          .modal-body {
            padding: 20px;
          }

          .strategy-name {
            font-size: 16px;
            font-weight: 600;
            color: #f0f6fc;
            margin-bottom: 4px;
          }

          .strategy-description {
            font-size: 13px;
            color: #8b949e;
            margin-bottom: 16px;
          }

          .condition-box,
          .action-box {
            background: #0d1117;
            border-radius: 8px;
            padding: 12px;
            margin-bottom: 12px;
          }

          .condition-label,
          .action-label {
            font-size: 11px;
            text-transform: uppercase;
            color: #6e7681;
            margin-bottom: 6px;
            font-weight: 500;
          }

          .condition-value {
            font-size: 14px;
            color: #79c0ff;
            font-family: "JetBrains Mono", monospace;
          }

          .condition-values {
            display: flex;
            gap: 16px;
            margin-top: 8px;
            font-size: 12px;
          }

          .current {
            color: #f0f6fc;
          }

          .target {
            color: #8b949e;
          }

          .action-value {
            font-size: 14px;
            color: #7ee787;
            font-family: "JetBrains Mono", monospace;
          }

          .time-ago {
            text-align: center;
            font-size: 12px;
            color: #6e7681;
            margin-top: 8px;
          }

          .modal-actions {
            display: flex;
            gap: 8px;
            padding: 16px 20px;
            background: #0d1117;
            border-top: 1px solid #21262d;
          }

          .action-btn {
            flex: 1;
            padding: 12px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.15s ease;
            font-family: inherit;
          }

          .action-btn.dismiss {
            background: transparent;
            border: 1px solid #30363d;
            color: #8b949e;
          }

          .action-btn.dismiss:hover:not(:disabled) {
            background: #21262d;
            color: #f0f6fc;
          }

          .action-btn.dismiss.primary {
            background: #21262d;
            color: #f0f6fc;
          }

          .action-btn.dismiss.primary:hover {
            background: #30363d;
          }

          .action-btn.snooze {
            background: #21262d;
            border: 1px solid #30363d;
            color: #f0883e;
          }

          .action-btn.snooze:hover:not(:disabled) {
            background: rgba(240, 136, 62, 0.1);
            border-color: #f0883e;
          }

          .action-btn.execute {
            background: linear-gradient(135deg, #238636 0%, #2ea043 100%);
            border: none;
            color: #ffffff;
          }

          .action-btn.execute:hover:not(:disabled) {
            background: linear-gradient(135deg, #2ea043 0%, #3fb950 100%);
            box-shadow: 0 0 20px rgba(46, 160, 67, 0.4);
          }

          .action-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
        `}</style>
      </div>
    </div>
  );
}

