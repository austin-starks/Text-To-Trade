import {
  Strategy,
  Condition,
  BaseCondition,
  CompoundCondition,
  Indicator,
  ComparisonOperator,
  StrategyEvaluation,
} from "../types/strategy";
import {
  getTokenPrice,
  isTokenSupportedForPrices,
} from "./price-service";

// Price cache for "crosses" comparisons (tracks previous values)
const crossesCache = new Map<string, number>();

/**
 * Get the current value of an indicator - REAL DATA ONLY
 */
export async function getIndicatorValue(
  indicator: Indicator,
  balances: Record<string, number>
): Promise<number | null> {
  switch (indicator.type) {
    case "price":
      if (!indicator.token) return null;
      return await getTokenPrice(indicator.token);

    case "balance":
      if (!indicator.token) return null;
      return balances[indicator.token] ?? balances[indicator.token.toUpperCase()] ?? 0;

    case "constant":
      return indicator.value ?? null;

    default:
      return null;
  }
}

/**
 * Compare two values using the specified operator
 */
export function compare(
  lhsValue: number,
  rhsValue: number,
  operator: ComparisonOperator,
  cacheKey?: string
): boolean {
  switch (operator) {
    case "greater_than":
      return lhsValue > rhsValue;

    case "less_than":
      return lhsValue < rhsValue;

    case "greater_than_or_equal":
      return lhsValue >= rhsValue;

    case "less_than_or_equal":
      return lhsValue <= rhsValue;

    case "equal":
      return Math.abs(lhsValue - rhsValue) < 0.0001; // Float comparison tolerance

    case "crosses_above":
      if (!cacheKey) return lhsValue > rhsValue;
      const prevAbove = crossesCache.get(cacheKey);
      crossesCache.set(cacheKey, lhsValue);
      if (prevAbove === undefined) return false;
      return prevAbove <= rhsValue && lhsValue > rhsValue;

    case "crosses_below":
      if (!cacheKey) return lhsValue < rhsValue;
      const prevBelow = crossesCache.get(cacheKey);
      crossesCache.set(cacheKey, lhsValue);
      if (prevBelow === undefined) return false;
      return prevBelow >= rhsValue && lhsValue < rhsValue;

    default:
      return false;
  }
}

/**
 * Evaluate a single base condition
 */
export async function evaluateBaseCondition(
  condition: BaseCondition,
  balances: Record<string, number>
): Promise<{ met: boolean; lhsValue: number | null; rhsValue: number | null }> {
  const lhsValue = await getIndicatorValue(condition.lhs, balances);
  const rhsValue = await getIndicatorValue(condition.rhs, balances);

  if (lhsValue === null || rhsValue === null) {
    return { met: false, lhsValue, rhsValue };
  }

  // Create cache key for "crosses" comparisons
  const cacheKey = condition.lhs.token 
    ? `${condition.lhs.token}-${condition.lhs.type}` 
    : undefined;

  const met = compare(lhsValue, rhsValue, condition.comparison, cacheKey);

  return { met, lhsValue, rhsValue };
}

/**
 * Evaluate a compound condition (AND/OR of multiple conditions)
 */
export async function evaluateCompoundCondition(
  condition: CompoundCondition,
  balances: Record<string, number>
): Promise<boolean> {
  if (condition.conditions.length === 0) return false;

  const results = await Promise.all(
    condition.conditions.map((c) => evaluateCondition(c, balances))
  );

  if (condition.operator === "and") {
    return results.every((r) => r);
  } else {
    return results.some((r) => r);
  }
}

/**
 * Evaluate any condition (base or compound)
 */
export async function evaluateCondition(
  condition: Condition,
  balances: Record<string, number>
): Promise<boolean> {
  if (condition.type === "base") {
    const result = await evaluateBaseCondition(condition as BaseCondition, balances);
    return result.met;
  } else if (condition.type === "compound") {
    return await evaluateCompoundCondition(condition as CompoundCondition, balances);
  }
  return false;
}

/**
 * Evaluate a complete strategy and return detailed results
 */
export async function evaluateStrategy(
  strategy: Strategy,
  balances: Record<string, number>
): Promise<StrategyEvaluation> {
  // Only evaluate active strategies
  if (strategy.status !== "active") {
    return {
      strategyId: strategy.id,
      conditionMet: false,
      currentValues: {},
      evaluatedAt: new Date(),
    };
  }

  // Check if strategy has exceeded max executions (0 = unlimited)
  if (strategy.maxExecutions > 0 && strategy.executionCount >= strategy.maxExecutions) {
    return {
      strategyId: strategy.id,
      conditionMet: false,
      currentValues: {},
      evaluatedAt: new Date(),
    };
  }

  // Check expiration
  if (strategy.expiresAt && new Date() > new Date(strategy.expiresAt)) {
    return {
      strategyId: strategy.id,
      conditionMet: false,
      currentValues: {},
      evaluatedAt: new Date(),
    };
  }

  let conditionMet = false;
  let currentValues: { lhs?: number; rhs?: number } = {};

  if (strategy.condition.type === "base") {
    const result = await evaluateBaseCondition(
      strategy.condition as BaseCondition,
      balances
    );
    conditionMet = result.met;
    currentValues = {
      lhs: result.lhsValue ?? undefined,
      rhs: result.rhsValue ?? undefined,
    };
  } else {
    conditionMet = await evaluateCondition(strategy.condition, balances);
  }

  return {
    strategyId: strategy.id,
    conditionMet,
    currentValues,
    evaluatedAt: new Date(),
  };
}

/**
 * Format a condition as human-readable text
 */
export function formatCondition(condition: Condition): string {
  if (condition.type === "base") {
    const base = condition as BaseCondition;
    const lhs = formatIndicator(base.lhs);
    const rhs = formatIndicator(base.rhs);
    const op = formatComparison(base.comparison);
    return `${lhs} ${op} ${rhs}`;
  } else {
    const compound = condition as CompoundCondition;
    const parts = compound.conditions.map(formatCondition);
    const joiner = compound.operator === "and" ? " AND " : " OR ";
    return `(${parts.join(joiner)})`;
  }
}

function formatIndicator(indicator: Indicator): string {
  switch (indicator.type) {
    case "price":
      return `${indicator.token} price`;
    case "balance":
      return `${indicator.token} balance`;
    case "constant":
      // Format as currency if it looks like a price
      const val = indicator.value ?? 0;
      if (val >= 100) {
        return `$${val.toLocaleString()}`;
      } else if (val >= 1) {
        return `$${val.toFixed(2)}`;
      } else {
        return `${val}`;
      }
    default:
      return "?";
  }
}

function formatComparison(op: ComparisonOperator): string {
  const map: Record<ComparisonOperator, string> = {
    greater_than: ">",
    less_than: "<",
    greater_than_or_equal: "≥",
    less_than_or_equal: "≤",
    equal: "=",
    crosses_above: "↗",
    crosses_below: "↘",
  };
  return map[op] || op;
}

/**
 * Format an action as human-readable text
 */
export function formatAction(action: Strategy["action"]): string {
  if (action.type === "swap") {
    const amount = action.sellPercentage 
      ? `${action.sellPercentage}% of` 
      : action.sellAmount || "some";
    return `Swap ${amount} ${action.sellToken} → ${action.buyToken}`;
  } else if (action.type === "alert") {
    return `Alert: ${action.message}`;
  }
  return "Unknown action";
}

/**
 * Validate that a condition uses only supported tokens
 */
export async function validateConditionTokens(condition: Condition): Promise<{ valid: boolean; unsupported: string[] }> {
  const unsupported: string[] = [];
  
  async function checkIndicator(indicator: Indicator) {
    if (indicator.type === "price") {
      if (indicator.token && !(await isTokenSupportedForPrices(indicator.token))) {
        unsupported.push(indicator.token);
      }
    }
  }
  
  if (condition.type === "base") {
    const base = condition as BaseCondition;
    await checkIndicator(base.lhs);
    await checkIndicator(base.rhs);
  } else if (condition.type === "compound") {
    const compound = condition as CompoundCondition;
    for (const c of compound.conditions) {
      const result = await validateConditionTokens(c);
      unsupported.push(...result.unsupported);
    }
  }
  
  return {
    valid: unsupported.length === 0,
    unsupported: [...new Set(unsupported)],
  };
}
