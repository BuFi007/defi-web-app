import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const defaultQRSize = 150;

export const sizeStyles = {
  container: {
    sm: 'w-48',
    base: 'w-64',
    lg: 'w-72'
  },
  input: {
    sm: 'text-lg',
    base: 'text-2xl',
    lg: 'text-6xl'
  },
  balance: {
    sm: 'text-xs',
    base: 'text-sm',
    lg: 'text-base'
  }
};