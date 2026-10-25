/**
 * A valid quick lead for the deployed endpoint (S4.4). The Stage 0 stub took three fields; the real endpoint takes the body of
 * architecture 8.2. It is posted with the measurement header (x-phase0-token), so the Worker skips Turnstile and stamps the lead
 * `source.measurement = true`: that server-side stamp, which a visitor cannot send, is how the workflow's cleanup step finds and
 * removes its own test rows. Each lead has a different number, because the endpoint allows five leads per WhatsApp number in 24 hours.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const pick = (n) => Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * 32)]).join("");
const digits = (n) => Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join("");

export function probeLead(overrides = {}) {
  return {
    intake_kind: "quick",
    name: "Probe Student",
    // Cameroon: 9 digits after +237.
    whatsapp: `+2376${digits(8)}`,
    country_code: "CM",
    source: { page: "/measure", university_id: crypto.randomUUID() },
    locale: "en",
    client_ref: `SC-${pick(5)}-${pick(5)}`,
    client_created_at: new Date().toISOString(),
    consent: { notice_version: "probe" },
    // Not checked: the measurement header makes the Worker skip Turnstile (the real secret stays on the Worker).
    turnstile_token: "dummy-token",
    ...overrides,
  };
}
