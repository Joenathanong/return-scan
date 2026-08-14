import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format } from "date-fns";
import { id as localeId } from "date-fns/locale";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function todayString(): string {
  return format(new Date(), "yyyy-MM-dd");
}

export function formatDate(dateStr: string): string {
  return format(new Date(dateStr), "dd MMMM yyyy", { locale: localeId });
}

export function formatDateTime(date: Date): string {
  return format(date, "dd/MM/yyyy HH:mm:ss", { locale: localeId });
}

export function formatTime(date: Date): string {
  return format(date, "HH:mm:ss");
}

export function sheetDateName(dateStr: string): string {
  // "2026-06-25" → "25-06-2026"
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

/** Sheet tab name: "JNE_25-06-2026" */
export function sheetTabName(expedisiCode: string, dateStr: string): string {
  return `${expedisiCode}_${sheetDateName(dateStr)}`;
}
