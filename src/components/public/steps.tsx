import { getTranslations } from "next-intl/server";
import type { FaqView, ProcessStepView } from "@/modules/content/types";

/**
 * Expandable lists use the browser's own `<details>`: they open and close without any script, and every answer is in
 * the HTML for visitors with JavaScript off and for search engines (FR-1).
 */

/** The ordered steps of A4 `/process` and `/visa`. A step is reachable by its `#<prefix>-N` link (A1 step 5). */
export async function StepList({ steps, idPrefix }: { steps: ProcessStepView[]; idPrefix: string }) {
  const t = await getTranslations("process");
  return (
    <ol className="steps">
      {steps.map((step) => (
        <li key={step.id} id={`${idPrefix}-${step.position}`}>
          <details open>
            <summary>
              <span className="step-number" aria-hidden="true">
                {step.position}
              </span>
              <span className="sr-only">{t("stepLabel", { number: step.position })}: </span>
              {step.title}
            </summary>
            <p>{step.body}</p>
          </details>
        </li>
      ))}
    </ol>
  );
}

/** Questions grouped by category. The category chips are plain in-page links, so they work without a script. */
export function FaqList({ faqs, generalLabel }: { faqs: FaqView[]; generalLabel: string }) {
  const groups = new Map<string, FaqView[]>();
  for (const item of faqs) {
    const key = item.category?.trim() || generalLabel;
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  const entries = [...groups.entries()];
  const anchor = (name: string) => `faq-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general"}`;

  return (
    <div>
      {entries.length > 1 ? (
        <ul className="chips plain">
          {entries.map(([name]) => (
            <li key={name}>
              <a className="chip" href={`#${anchor(name)}`}>
                {name}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {entries.map(([name, items]) => (
        <section key={name} id={anchor(name)} aria-label={entries.length > 1 ? name : undefined} className="faq-group">
          {entries.length > 1 ? <h2>{name}</h2> : null}
          {items.map((item) => (
            <details key={item.id} className="faq-item">
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </section>
      ))}
    </div>
  );
}
