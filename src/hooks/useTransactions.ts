import { useEffect, useState } from 'react';
import {
  subscribeDailyEntries,
  subscribeTransactionsByDate,
  subscribeTransactionsRange,
} from '../services/transactionService';
import { subscribeMealItems } from '../services/mealItemService';
import type { DailyEntry, MealItem, Transaction } from '../types';

/** Realtime transactions for one day (dashboard, serial page). */
export function useTransactionsByDate(date: string): { txns: Transaction[]; loading: boolean; error: string | null } {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    let gotFirst = false;
    const unsub = subscribeTransactionsByDate(
      date,
      (list) => {
        gotFirst = true;
        setTxns(list);
        setLoading(false);
        setError(null);
      },
      (msg) => {
        gotFirst = true;
        setError(msg);
        setLoading(false);
      },
    );
    return () => {
      unsub();
      if (!gotFirst) setLoading(false);
    };
  }, [date]);

  return { txns, loading, error };
}

/** Realtime transactions in a date range (transactions page, reports). */
export function useTransactionsRange(from: string, to: string): { txns: Transaction[]; loading: boolean; error: string | null } {
  const [txns, setTxns] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    let gotFirst = false;
    const unsub = subscribeTransactionsRange(
      from,
      to,
      (list) => {
        gotFirst = true;
        setTxns(list);
        setLoading(false);
        setError(null);
      },
      (msg) => {
        gotFirst = true;
        setError(msg);
        setLoading(false);
      },
    );
    return () => {
      unsub();
      if (!gotFirst) setLoading(false);
    };
  }, [from, to]);

  return { txns, loading, error };
}

/** Realtime daily billing sheet (Serial page). */
export function useDailyEntries(from: string, to: string): { entries: DailyEntry[]; loading: boolean; error: string | null } {
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    let gotFirst = false;
    const unsub = subscribeDailyEntries(
      from,
      to,
      (list) => {
        gotFirst = true;
        setEntries(list);
        setLoading(false);
        setError(null);
      },
      (msg) => {
        gotFirst = true;
        setError(msg);
        setLoading(false);
      },
    );
    return () => {
      unsub();
      if (!gotFirst) setLoading(false);
    };
  }, [from, to]);

  return { entries, loading, error };
}

/** Realtime addon menu. */
export function useMealItems(): { items: MealItem[]; loading: boolean; error: string | null } {
  const [items, setItems] = useState<MealItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gotFirst = false;
    const unsub = subscribeMealItems(
      (list) => {
        gotFirst = true;
        setItems(list);
        setLoading(false);
        setError(null);
      },
      (msg) => {
        gotFirst = true;
        setError(msg);
        setLoading(false);
      },
    );
    return () => {
      unsub();
      if (!gotFirst) setLoading(false);
    };
  }, []);

  return { items, loading, error };
}
