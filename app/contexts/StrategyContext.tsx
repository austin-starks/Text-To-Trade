"use client";

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import { Strategy, StrategyStatus, StrategyEvaluation, Condition, BaseCondition, CompoundCondition } from "../types/strategy";
import { evaluateStrategy } from "../lib/strategy-executor";
import { prefetchPrices } from "../lib/price-service";

/**
 * Extract all tokens used in a condition (recursively for compound conditions)
 */
function extractTokensFromCondition(condition: Condition): string[] {
  const tokens: string[] = [];
  
  if ("conditions" in condition) {
    // Compound condition - recurse
    const compound = condition as CompoundCondition;
    for (const subCondition of compound.conditions) {
      tokens.push(...extractTokensFromCondition(subCondition));
    }
  } else {
    // Base condition - extract tokens from lhs and rhs
    const base = condition as BaseCondition;
    if (base.lhs?.token) tokens.push(base.lhs.token);
    if (base.rhs?.token) tokens.push(base.rhs.token);
  }
  
  return tokens;
}

/**
 * Extract all unique tokens from a list of strategies
 */
function extractTokensFromStrategies(strategies: Strategy[]): string[] {
  const tokens = new Set<string>();
  
  for (const strategy of strategies) {
    if (strategy.status !== "active") continue;
    const strategyTokens = extractTokensFromCondition(strategy.condition);
    strategyTokens.forEach(t => tokens.add(t.toUpperCase()));
  }
  
  return Array.from(tokens);
}

interface TriggeredStrategy {
  strategy: Strategy;
  evaluation: StrategyEvaluation;
  triggeredAt: Date;
  snoozedUntil?: Date;
}

interface StrategyContextType {
  strategies: Strategy[];
  addStrategy: (strategy: Strategy) => void;
  updateStrategy: (id: string, updates: Partial<Strategy>) => void;
  removeStrategy: (id: string) => void;
  updateStrategyStatus: (id: string, status: StrategyStatus) => void;
  pauseStrategy: (id: string) => void;
  resumeStrategy: (id: string) => void;
  snoozeStrategy: (id: string, minutes: number) => void;
  markExecuted: (id: string) => void;
  dismissTriggered: (id: string) => void;
  triggeredStrategies: TriggeredStrategy[];
  evaluations: Map<string, StrategyEvaluation>;
  isEvaluating: boolean;
  setBalances: (balances: Record<string, number>) => void;
}

const StrategyContext = createContext<StrategyContextType | null>(null);

const STORAGE_KEY = "text-to-trade-strategies";
const SNOOZED_KEY = "text-to-trade-snoozed";
const EVAL_INTERVAL_MS = 30000; // Check every 30 seconds
const TRIGGER_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export function StrategyProvider({ children }: { children: React.ReactNode }) {
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [triggeredStrategies, setTriggeredStrategies] = useState<TriggeredStrategy[]>([]);
  const [evaluations, setEvaluations] = useState<Map<string, StrategyEvaluation>>(new Map());
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState<Map<string, Date>>(new Map());
  const [balances, setBalancesState] = useState<Record<string, number>>({});
  const evalIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const balancesRef = useRef<Record<string, number>>({});

  // Keep balances ref in sync
  useEffect(() => {
    balancesRef.current = balances;
  }, [balances]);

  const setBalances = useCallback((newBalances: Record<string, number>) => {
    setBalancesState(newBalances);
  }, []);

  // Load strategies from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const hydrated = parsed.map((s: Strategy) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          triggeredAt: s.triggeredAt ? new Date(s.triggeredAt) : undefined,
          expiresAt: s.expiresAt ? new Date(s.expiresAt) : undefined,
          lastTriggeredAt: s.lastTriggeredAt ? new Date(s.lastTriggeredAt) : undefined,
          // Ensure defaults for legacy strategies
          isRecurring: s.isRecurring ?? false,
          maxExecutions: s.maxExecutions ?? 1,
          cooldownMs: s.cooldownMs ?? 0,
        }));
        setStrategies(hydrated);
      }

      // Load snoozed times
      const snoozedStored = localStorage.getItem(SNOOZED_KEY);
      if (snoozedStored) {
        const snoozedParsed = JSON.parse(snoozedStored);
        const snoozedMap = new Map<string, Date>();
        for (const [id, time] of Object.entries(snoozedParsed)) {
          snoozedMap.set(id, new Date(time as string));
        }
        setSnoozedUntil(snoozedMap);
      }
    } catch (error) {
      console.warn("Failed to load strategies from storage");
    }
  }, []);

  // Save strategies to localStorage when they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(strategies));
    } catch (error) {
      console.warn("Failed to save strategies to storage");
    }
  }, [strategies]);

  // Save snoozed times
  useEffect(() => {
    try {
      const snoozedObj: Record<string, string> = {};
      snoozedUntil.forEach((date, id) => {
        snoozedObj[id] = date.toISOString();
      });
      localStorage.setItem(SNOOZED_KEY, JSON.stringify(snoozedObj));
    } catch (error) {
      console.warn("Failed to save snoozed times");
    }
  }, [snoozedUntil]);

  // Evaluate all active strategies - NOW ASYNC
  const evaluateAllStrategies = useCallback(async () => {
    if (isEvaluating) return; // Prevent overlapping evaluations
    
    setIsEvaluating(true);
    const now = new Date();
    const nowMs = now.getTime();
    const newEvaluations = new Map<string, StrategyEvaluation>();
    const newTriggered: TriggeredStrategy[] = [];
    const currentBalances = balancesRef.current;

    // Prefetch prices for tokens used in active strategies
    const strategyTokens = extractTokensFromStrategies(strategies);
    if (strategyTokens.length > 0) {
      await prefetchPrices(strategyTokens);
    }

    // Filter strategies that need evaluation
    const toEvaluate = strategies.filter((strategy) => {
      // Skip non-active strategies
      if (strategy.status !== "active") return false;

      // Skip if max executions reached (0 = unlimited)
      if (strategy.maxExecutions > 0 && strategy.executionCount >= strategy.maxExecutions) return false;

      // Skip if user-snoozed
      const snoozed = snoozedUntil.get(strategy.id);
      if (snoozed && now < snoozed) return false;

      // Skip if in cooldown (for recurring strategies)
      if (strategy.isRecurring && strategy.lastTriggeredAt && strategy.cooldownMs > 0) {
        const cooldownEnds = new Date(strategy.lastTriggeredAt).getTime() + strategy.cooldownMs;
        if (nowMs < cooldownEnds) return false;
      }

      // Skip if already in triggered list
      if (triggeredStrategies.some((t) => t.strategy.id === strategy.id)) return false;

      return true;
    });

    // Evaluate all in parallel
    const evaluationPromises = toEvaluate.map(async (strategy) => {
      try {
        const evaluation = await evaluateStrategy(strategy, currentBalances);
        return { strategy, evaluation };
      } catch (error) {
        console.error(`Failed to evaluate strategy ${strategy.id}:`, error);
        return null;
      }
    });

    const results = await Promise.all(evaluationPromises);

    for (const result of results) {
      if (!result) continue;
      
      const { strategy, evaluation } = result;
      newEvaluations.set(strategy.id, evaluation);

      if (evaluation.conditionMet) {
        newTriggered.push({
          strategy,
          evaluation,
          triggeredAt: now,
        });
      }
    }

    setEvaluations(newEvaluations);

    if (newTriggered.length > 0) {
      setTriggeredStrategies((prev) => [...prev, ...newTriggered]);
    }

    setIsEvaluating(false);
  }, [strategies, snoozedUntil, triggeredStrategies, isEvaluating]);

  // Start evaluation loop
  useEffect(() => {
    // Initial evaluation
    if (strategies.length > 0) {
      evaluateAllStrategies();
    }

    // Set up interval
    evalIntervalRef.current = setInterval(() => {
      evaluateAllStrategies();
    }, EVAL_INTERVAL_MS);

    return () => {
      if (evalIntervalRef.current) {
        clearInterval(evalIntervalRef.current);
      }
    };
  }, [strategies.length]); // Re-create interval when strategies count changes

  // Clean up old triggered strategies (older than 15 minutes)
  useEffect(() => {
    const now = new Date();
    setTriggeredStrategies((prev) =>
      prev.filter((t) => now.getTime() - t.triggeredAt.getTime() < TRIGGER_WINDOW_MS)
    );
  }, [evaluations]); // Run when evaluations update

  const addStrategy = useCallback((strategy: Strategy) => {
    setStrategies((prev) => [...prev, strategy]);
  }, []);

  const updateStrategy = useCallback((id: string, updates: Partial<Strategy>) => {
    setStrategies((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s))
    );
  }, []);

  const removeStrategy = useCallback((id: string) => {
    setStrategies((prev) => prev.filter((s) => s.id !== id));
    setEvaluations((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setTriggeredStrategies((prev) => prev.filter((t) => t.strategy.id !== id));
  }, []);

  const updateStrategyStatus = useCallback((id: string, status: StrategyStatus) => {
    setStrategies((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              status,
              triggeredAt: status === "triggered" ? new Date() : s.triggeredAt,
              executionCount: status === "triggered" ? s.executionCount + 1 : s.executionCount,
            }
          : s
      )
    );
  }, []);

  const pauseStrategy = useCallback((id: string) => {
    updateStrategyStatus(id, "paused");
    setTriggeredStrategies((prev) => prev.filter((t) => t.strategy.id !== id));
  }, [updateStrategyStatus]);

  const resumeStrategy = useCallback((id: string) => {
    updateStrategyStatus(id, "active");
  }, [updateStrategyStatus]);

  const snoozeStrategy = useCallback((id: string, minutes: number) => {
    const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);
    setSnoozedUntil((prev) => {
      const next = new Map(prev);
      next.set(id, snoozeUntil);
      return next;
    });
    // Remove from triggered list
    setTriggeredStrategies((prev) => prev.filter((t) => t.strategy.id !== id));
  }, []);

  const markExecuted = useCallback((id: string) => {
    setStrategies((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        
        const newExecutionCount = s.executionCount + 1;
        const maxReached = s.maxExecutions > 0 && newExecutionCount >= s.maxExecutions;
        
        // For recurring strategies: keep active (with cooldown) unless max reached
        // For one-time: mark as triggered (done)
        const newStatus: StrategyStatus = 
          s.isRecurring && !maxReached ? "active" : "triggered";
        
        return {
          ...s,
          status: newStatus,
          executionCount: newExecutionCount,
          triggeredAt: new Date(),
          lastTriggeredAt: new Date(),
        };
      })
    );
    setTriggeredStrategies((prev) => prev.filter((t) => t.strategy.id !== id));
  }, []);

  const dismissTriggered = useCallback((id: string) => {
    setTriggeredStrategies((prev) => prev.filter((t) => t.strategy.id !== id));
  }, []);

  return (
    <StrategyContext.Provider
      value={{
        strategies,
        addStrategy,
        updateStrategy,
        removeStrategy,
        updateStrategyStatus,
        pauseStrategy,
        resumeStrategy,
        snoozeStrategy,
        markExecuted,
        dismissTriggered,
        triggeredStrategies,
        evaluations,
        isEvaluating,
        setBalances,
      }}
    >
      {children}
    </StrategyContext.Provider>
  );
}

export function useStrategies() {
  const context = useContext(StrategyContext);
  if (!context) {
    throw new Error("useStrategies must be used within a StrategyProvider");
  }
  return context;
}
