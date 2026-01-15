// Strategy Types - Conditional trading strategies

// ============================================
// DEFAULT VALUES
// ============================================

export const STRATEGY_DEFAULTS = {
  // One-time strategy: triggers once and done
  ONE_TIME: {
    isRecurring: false,
    maxExecutions: 1,
    cooldownMs: 0,  // No cooldown needed for one-time
  },
  // Recurring strategy: can trigger multiple times with cooldown
  RECURRING: {
    isRecurring: true,
    maxExecutions: 0,  // 0 = unlimited
    cooldownMs: 4 * 60 * 60 * 1000,  // 4 hours default cooldown
  },
  // Preset cooldown options (in ms)
  COOLDOWNS: {
    NONE: 0,
    ONE_HOUR: 1 * 60 * 60 * 1000,
    FOUR_HOURS: 4 * 60 * 60 * 1000,
    TWELVE_HOURS: 12 * 60 * 60 * 1000,
    ONE_DAY: 24 * 60 * 60 * 1000,
    ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
  },
} as const;

// ============================================
// INDICATORS - Values that can be compared
// ============================================

export type IndicatorType = 
  | "price"           // Current token price in USD (from 1inch DEX)
  | "balance"         // User's token balance (real on-chain data)
  | "constant";       // A fixed number for comparison

export interface Indicator {
  type: IndicatorType;
  token?: string;      // Token symbol (e.g., "ETH", "cbBTC") - must be in supported list
  value?: number;      // For constant type
}

// ============================================
// CONDITIONS - Logic for when to execute
// ============================================

export type ComparisonOperator = 
  | "greater_than"
  | "less_than"
  | "greater_than_or_equal"
  | "less_than_or_equal"
  | "equal"
  | "crosses_above"    // For detecting when price crosses a threshold
  | "crosses_below";

export interface BaseCondition {
  type: "base";
  lhs: Indicator;      // Left-hand side
  rhs: Indicator;      // Right-hand side
  comparison: ComparisonOperator;
}

export interface CompoundCondition {
  type: "compound";
  operator: "and" | "or";
  conditions: Condition[];
}

export type Condition = BaseCondition | CompoundCondition;

// ============================================
// ACTIONS - What to do when condition is met
// ============================================

export type ActionType = "swap" | "alert";

export interface SwapAction {
  type: "swap";
  sellToken: string;
  buyToken: string;
  sellAmount?: string;     // Fixed amount to sell
  sellPercentage?: number; // Percentage of balance to sell (0-100)
}

export interface AlertAction {
  type: "alert";
  message: string;
}

export type StrategyAction = SwapAction | AlertAction;

// ============================================
// STRATEGY - The complete strategy definition
// ============================================

export type StrategyStatus = 
  | "active"      // Currently monitoring
  | "paused"      // Temporarily disabled
  | "triggered"   // Condition met, action executed
  | "expired"     // No longer valid
  | "failed";     // Execution failed

export interface Strategy {
  id: string;
  name: string;
  description: string;      // Human-readable description
  condition: Condition;
  action: StrategyAction;
  status: StrategyStatus;
  createdAt: Date;
  triggeredAt?: Date;
  expiresAt?: Date;         // Optional expiration
  executionCount: number;
  ownerAddress: string;     // Wallet that owns this strategy
  
  // Recurring/Cooldown Configuration
  isRecurring: boolean;     // If true, can trigger multiple times
  maxExecutions: number;    // Max triggers (0 = unlimited, default 1 for one-time)
  cooldownMs: number;       // Cooldown between triggers in ms (default 4 hours for recurring)
  lastTriggeredAt?: Date;   // When it last triggered (for cooldown tracking)
}

// ============================================
// HELPERS - Utility types
// ============================================

export interface StrategyEvaluation {
  strategyId: string;
  conditionMet: boolean;
  currentValues: {
    lhs?: number;
    rhs?: number;
  };
  evaluatedAt: Date;
}

export interface CreateStrategyRequest {
  input: string;            // Natural language input
  ownerAddress: string;
}

export interface CreateStrategyResponse {
  success: boolean;
  strategy?: Strategy;
  error?: string;
  reasoning?: string;
}

