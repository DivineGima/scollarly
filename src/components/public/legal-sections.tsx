import { Fragment } from "react";

export interface LegalSection {
  heading: string;
  items: string[];
}

/** Splits a sentence around `{email}` so the address becomes a mailto link. Everything else stays plain text. */
function withEmail(text: string, email: string) {
  const parts = text.split("{email}");
  return parts.map((part, index) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 ? <a href={`mailto:${email}`}>{email}</a> : null}
    </Fragment>
  ));
}

/**
 * The body of a legal page (Privacy, Terms): headings and short lists, all text from translation keys. Plain server markup with
 * no script, so the page is complete without JavaScript and costs no bytes.
 */
export function LegalSections({ intro, updated, sections, email }: { intro: string; updated: string; sections: LegalSection[]; email: string }) {
  return (
    <>
      <p className="muted">{updated}</p>
      <p>{intro}</p>
      {sections.map((section, index) => (
        <section key={section.heading} aria-labelledby={`legal-${index}`} className="section">
          <h2 id={`legal-${index}`}>{section.heading}</h2>
          <ul>
            {section.items.map((item) => (
              <li key={item}>{withEmail(item, email)}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
