import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** API base for the Ajna backend. */
export const API = "http://localhost:8000";
export const WS_URL = "ws://localhost:8000/ws";
