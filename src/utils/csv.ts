import type { DailyEntry, Employee, Transaction } from '../types';
import { formatTime12h } from './format';

function csvEscape(value: string | number): string {
  const s = String(value);
  if (/[\",\n\r]/.test(s)) return `\"${s.replace(/\"/g, '\"\"')}\"`;
  return s;
}

function addonsLabel(t: Transaction): string {
  if (!t.addons?.length) return '';
  return t.addons.map((a) => `${a.name} ₹${a.price}`).join('; ');
}

/** Full transaction export (Transactions page). */
export function transactionsToCsv(transactions: Transaction[]): string {
  const header = ['Date', 'Time', 'Employee No', 'Serial No', 'Name', 'Department', 'QR', 'Meal', 'Meal Amount', 'Additional Items', 'Additional Amount', 'Total Amount', 'Mode'];
  const rows = transactions.map((t) => [
    t.date,
    formatTime12h(t.time),
    t.employeeNo,
    t.serial,
    t.name,
    t.department,
    t.qrType === 'lunchDinner' ? 'Lunch/Dinner QR' : 'Breakfast/Snacks QR',
    t.meal,
    t.mealAmount,
    addonsLabel(t),
    t.addonAmount,
    t.amount,
    t.mode,
  ]);
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

/** Serial Number Page export: one row per employee per day. */
export function dailyEntriesToCsv(entries: DailyEntry[]): string {
  const header = ['Serial No', 'Employee No', 'Name', 'Department', 'Date', 'Breakfast', 'Snacks', 'Lunch', 'Dinner', 'Additional', 'Total'];
  const rows = entries.map((e) => [
    e.serial,
    e.employeeNo,
    e.name,
    e.department,
    e.date,
    e.breakfast,
    e.snacks,
    e.lunch,
    e.dinner,
    e.addonAmount,
    e.total,
  ]);
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function employeesToCsv(employees: Employee[]): string {
  const header = ['Serial Number', 'Employee No', 'Name', 'Department', 'Active', 'Created At', 'Updated At'];
  const rows = employees.map((e) => [
    e.serial,
    e.employeeNo,
    e.name,
    e.department,
    e.active ? 'Yes' : 'No',
    new Date(e.createdAt).toISOString(),
    new Date(e.updatedAt).toISOString(),
  ]);
  return [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['\\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }); // BOM for Excel
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
