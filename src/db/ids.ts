import {v7 as uuidv7} from 'uuid';

/**
 * UUIDv7 rather than v4: the first 48 bits are a millisecond timestamp, so ids
 * sort by creation time. That gives stable ordering for rows created on
 * different offline devices without a shared counter, and keeps IndexedDB and
 * Postgres index locality sane.
 */
export function newId(): string {
  return uuidv7();
}

/** Epoch milliseconds. Wrapped so tests can stub a clock in one place. */
export function now(): number {
  return Date.now();
}
