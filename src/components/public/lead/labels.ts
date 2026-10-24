/**
 * Every string the two lead forms show, passed in as props by the server component that renders them. The forms are client
 * code, and this keeps next-intl's runtime out of the browser bundle (architecture 6.3). `getLeadLabels` fills it from the
 * `apply` namespace of the message files, so French needs only translated messages (ADR-018).
 */
export interface LeadLabels {
  // Fields
  name: string;
  whatsapp: string;
  whatsappHelp: string;
  country: string;
  chooseCountry: string;
  email: string;
  emailHelp: string;
  university: string;
  chooseUniversity: string;
  qualification: string;
  qualOlevel: string;
  qualGrade: string;
  results: string;
  resultsHelp: string;
  subject: string;
  grade: string;
  addResult: string;
  removeRow: string;
  // Programmes
  programmes: string;
  programmesHelp: string;
  searchProgrammes: string;
  noProgrammeMatch: string;
  chosen: string;
  rank: string;
  add: string;
  remove: string;
  moveUp: string;
  moveDown: string;
  // Consent and actions
  consent: string;
  privacyLink: string;
  continue: string;
  saving: string;
  sending: string;
  cancel: string;
  close: string;
  // Quick form
  quickTitle: string;
  quickIntro: string;
  quickAbout: string;
  // Apply page
  applyTitle: string;
  applyIntro: string;
  savedBanner: string;
  removeFromPhone: string;
  confirmRemove: string;
  keep: string;
  resendNow: string;
  statusSaved: string;
  statusSending: string;
  statusSent: string;
  statusNotSent: string;
  statusRejected: string;
  offlineNote: string;
  // Results
  doneSentTitle: string;
  doneSavedTitle: string;
  doneSentBody: string;
  doneSavedBody: string;
  reference: string;
  openWhatsApp: string;
  whatsappBlocked: string;
  noWhatsApp: string;
  completeApplication: string;
  couldntSave: string;
  couldntSaveHelp: string;
  copyDetails: string;
  copied: string;
  limitedRate: string;
  limitedNumber: string;
  turnstilePrompt: string;
  turnstileFailed: string;
  // WhatsApp message templates (placeholders in braces)
  waQuick: string;
  waFull: string;
  waAboutUniversity: string;
  waAboutProgramme: string;
  waProgrammes: string;
  /** Message token to text: REQUIRED, TOO_LONG, INVALID, PHONE_INVALID, PROGRAMMES_MIN_3, ... */
  errors: Record<string, string>;
  countries: Record<string, string>;
}

/** The common shape the island gets for the page-level universities (id and name). */
export interface UniversityOption {
  id: string;
  name: string;
}

export interface ProgrammeOption {
  id: string;
  name: string;
  universityId: string;
  universityName: string;
}

/** Message tokens a form can show, with the safe fallback text when a translation is missing. */
export const FALLBACK_ERROR = "Check this field.";
export function errorText(labels: LeadLabels, token: string | undefined): string | undefined {
  if (!token) return undefined;
  return labels.errors[token] ?? FALLBACK_ERROR;
}
