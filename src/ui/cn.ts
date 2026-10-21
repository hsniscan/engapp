import { clsx, type ClassValue } from 'clsx';

/** Joins class names. Callers' classes come last so they can extend a component. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
