import type { LogEvent } from "./types";

export const LOG_LIMIT = 2000;

/** リングバッファとして追記する。元の配列は変更しない。 */
export function pushLog(log: LogEvent[], ev: LogEvent): LogEvent[] {
  const next = [...log, ev];
  return next.length > LOG_LIMIT ? next.slice(next.length - LOG_LIMIT) : next;
}
