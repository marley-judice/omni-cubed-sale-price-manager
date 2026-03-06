const PACIFIC_TZ = "America/Los_Angeles";

/**
 * Given a date string like "2026-03-15", returns a Date object
 * representing 12:00:00 AM Pacific Time on that date.
 */
export function startOfDayPT(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const formatted = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00`;

  const utcGuess = new Date(formatted + "Z");
  const offset = getOffsetMinutes(utcGuess, PACIFIC_TZ);
  return new Date(utcGuess.getTime() + offset * 60_000);
}

/**
 * Given a date string like "2026-03-15", returns a Date object
 * representing 11:59:59 PM Pacific Time on that date.
 */
export function endOfDayPT(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  const formatted = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T23:59:59`;

  const utcGuess = new Date(formatted + "Z");
  const offset = getOffsetMinutes(utcGuess, PACIFIC_TZ);
  return new Date(utcGuess.getTime() + offset * 60_000);
}

/**
 * Returns the UTC offset in minutes for a given timezone at a given instant.
 * Positive means behind UTC (e.g. PST = +480, PDT = +420).
 */
function getOffsetMinutes(date: Date, tz: string): number {
  const utcStr = date.toLocaleString("en-US", { timeZone: "UTC" });
  const tzStr = date.toLocaleString("en-US", { timeZone: tz });
  const utcDate = new Date(utcStr);
  const tzDate = new Date(tzStr);
  return (utcDate.getTime() - tzDate.getTime()) / 60_000;
}

/**
 * Format a Date for display in Pacific Time.
 */
export function formatDatePT(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    timeZone: PACIFIC_TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export { PACIFIC_TZ };
