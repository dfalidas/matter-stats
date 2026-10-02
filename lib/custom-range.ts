export type CustomRangeValidation =
  | { ok: true; start: string; end: string }
  | { ok: false; message: string };

export function validateCustomRange(start: string | null, end: string | null): CustomRangeValidation {
  if (!start || !end) return { ok: false, message: "Choose both a start date and an end date." };
  if (start > end) return { ok: false, message: "The start date must be on or before the end date." };
  return { ok: true, start, end };
}
