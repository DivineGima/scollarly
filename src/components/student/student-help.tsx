/* eslint-disable @next/next/no-html-link-for-pages -- the guides are public pages with their own chrome, so opening one is a full page load on purpose */

import { buildWhatsAppUrl } from "@/lib/whatsapp";

export interface HelpLabels {
  title: string;
  intro: string;
  guides: string;
  process: string;
  visa: string;
  faq: string;
  contact: string;
  whatsapp: string;
  whatsappText: string;
  whatsappMissing: string;
}

/**
 * The Help tab (architecture 21.4; S13.4): the public guides and the one WhatsApp button. No data call: the number is the public one
 * from the site settings, embedded when the page is built, so the page is the same for everyone and works from the kept shell offline.
 */
export function StudentHelp({ labels, whatsappE164 }: { labels: HelpLabels; whatsappE164: string | null }) {
  const url = buildWhatsAppUrl(whatsappE164, labels.whatsappText);
  return (
    <section>
      <h1>{labels.title}</h1>
      <p>{labels.intro}</p>
      <h2>{labels.guides}</h2>
      <ul className="help-links">
        <li>
          <a href="/process">{labels.process}</a>
        </li>
        <li>
          <a href="/visa">{labels.visa}</a>
        </li>
        <li>
          <a href="/faq">{labels.faq}</a>
        </li>
        <li>
          <a href="/contact">{labels.contact}</a>
        </li>
      </ul>
      {url ? (
        <a className="me-button" href={url} target="_blank" rel="noopener noreferrer" data-testid="whatsapp">
          {labels.whatsapp}
        </a>
      ) : (
        <p className="me-muted">{labels.whatsappMissing}</p>
      )}
    </section>
  );
}
