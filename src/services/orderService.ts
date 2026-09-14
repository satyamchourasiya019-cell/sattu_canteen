/**
 * Legacy shim — the app now uses transactionService (QR billing model).
 * Kept only so stray imports fail loudly at compile time with a hint.
 */
export {
  subscribeTransactionsByDate as subscribeOrdersByDate,
  subscribeTransactionsRange as subscribeOrdersRange,
  aggregateDailyEntries,
  createManualEntry,
  deleteTransaction,
  cleanupOldTransactions,
} from './transactionService';
