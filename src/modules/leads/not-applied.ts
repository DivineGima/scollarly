import type { NotAppliedRow } from "@/server/repositories/not-applied";

/**
 * The "Not applied yet" list as the screen gets it (PRD_4 F27, architecture 23.6). Pure, so the rules are tested without a database. Staff see a
 * first name and the first letter of the last name, never the whole name: the list is for a friendly nudge on WhatsApp, and the number is what
 * they need to send it. Times travel as UTC instants; the screen shows them in WAT.
 */

export interface NotAppliedItem {
  id: string;
  /** "Amina F.", or just "Amina" for a one-word name. */
  name: string;
  country: string;
  courseFields: string[];
  onboardedAt: string;
  whatsapp: string;
}

/** A first name and the initial of the last word, or the first name alone. Extra spaces are ignored; an empty name gives an empty string. */
export function firstNameAndInitial(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return "";
  const last = words.length > 1 ? words[words.length - 1] : undefined;
  const initial = last ? Array.from(last)[0] : undefined;
  return initial ? `${first} ${initial.toLocaleUpperCase("en")}.` : first;
}

export function notAppliedItem(row: NotAppliedRow): NotAppliedItem {
  return {
    id: row.userId,
    name: firstNameAndInitial(row.applicantName),
    country: row.country,
    courseFields: row.courseFields,
    onboardedAt: row.onboardedAt.toISOString(),
    whatsapp: row.whatsappE164,
  };
}
