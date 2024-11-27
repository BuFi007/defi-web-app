import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const defaultQRSize = 150;

export const sizeStyles = {
  container: {
    sm: 'w-64',
    base: 'w-72',
    lg: 'w-80'
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