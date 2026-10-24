"use client";

import { useEffect, useRef, useState } from "react";
import { fillTemplate, buildQuickPayload, validateQuick, type FieldErrors } from "@/lib/lead-form";
import { pageGroupOf } from "@/lib/page-group";
import { trackEvent } from "@/offline/events";
import { PageLink } from "../page-link";
import { errorText, type LeadLabels, type UniversityOption } from "./labels";
import { ConsentField, CountrySelect, describedBy, detailsTextOf, Field, FlowResult, TurnstileBox } from "./lead-parts";
import { useLeadFlow } from "./use-lead-flow";

interface Opened {
  page: string;
  universityId?: string | undefined;
  universityName?: string | undefined;
  programmeId?: string | undefined;
}

/**
 * The quick WhatsApp form (ADR-030, architecture 16 A5b). Every "Chat on WhatsApp" button on the site is a plain link into
 * the chat (it works with JavaScript off); this island catches the tap, asks for name, number and country, saves a quick lead
 * through the same send-first path as the full form, and then opens the same chat with the reference. It is mounted once in the
 * public layout. If the site has no published university, the quick lead could not satisfy its rule (a university or a programme
 * from the page), so the island steps aside and the link works as a link.
 */
export function QuickWhatsApp({
  labels,
  universities,
  numberE164,
  siteKey,
  locale,
}: {
  labels: LeadLabels;
  universities: UniversityOption[];
  numberE164: string | null;
  siteKey: string;
  locale: string;
}) {
  const [opened, setOpened] = useState<Opened | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[data-wa-chat]") as HTMLAnchorElement | null;
      if (!link) return;
      const universityId = link.dataset.waUniversityId || undefined;
      // No university on the page and none to choose from: leave the link alone.
      if (!universityId && !link.dataset.waProgrammeId && universities.length === 0) return;
      event.preventDefault();
      setOpened({
        page: link.dataset.waPage || location.pathname,
        universityId,
        universityName: link.dataset.waUniversityName || undefined,
        programmeId: link.dataset.waProgrammeId || undefined,
      });
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [universities.length]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (opened && !dialog.open) {
      dialog.showModal();
      void trackEvent({ type: "form_start", ...(opened.universityId ? { universityId: opened.universityId } : {}), pageGroup: pageGroupOf(location.pathname) });
    }
    if (!opened && dialog.open) dialog.close();
  }, [opened]);

  return (
    <dialog ref={dialogRef} className="lead-dialog" aria-labelledby="quick-title" onClose={() => setOpened(null)}>
      {opened ? <QuickForm key={`${opened.page}:${opened.universityId ?? ""}`} opened={opened} labels={labels} universities={universities} numberE164={numberE164} siteKey={siteKey} locale={locale} onClose={() => setOpened(null)} /> : null}
    </dialog>
  );
}

function QuickForm({
  opened,
  labels,
  universities,
  numberE164,
  siteKey,
  locale,
  onClose,
}: {
  opened: Opened;
  labels: LeadLabels;
  universities: UniversityOption[];
  numberE164: string | null;
  siteKey: string;
  locale: string;
  onClose: () => void;
}) {
  const [values, setValues] = useState({ name: "", country: "", whatsapp: "", consent: false });
  const [chosenUniversity, setChosenUniversity] = useState(opened.universityId ?? "");
  const [errors, setErrors] = useState<FieldErrors>({});
  const flow = useLeadFlow({ siteKey, numberE164 });

  const context = { page: opened.page, universityId: chosenUniversity || undefined, programmeId: opened.programmeId, locale, search: typeof location === "undefined" ? "" : location.search };
  const universityName = opened.universityName ?? universities.find((u) => u.id === chosenUniversity)?.name ?? "";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validateQuick(values, context);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const payload = buildQuickPayload(values, context);
    await flow.start({
      payload,
      universityId: context.universityId,
      onRejected: (fields) => setErrors({ ...fields, ...(fields.source_university_id ? { university: fields.source_university_id } : {}) }),
      messageFor: (ref) =>
        fillTemplate(labels.waQuick, {
          name: values.name.trim(),
          country: labels.countries[values.country] ?? values.country,
          ref,
          about: universityName ? fillTemplate(labels.waAboutUniversity, { university: universityName }) : "",
        }).trim(),
    });
  }

  const busy = flow.state.phase === "submitting";

  if (flow.state.phase !== "idle" && flow.state.phase !== "submitting") {
    return (
      <div className="lead-panel">
        <FlowResult
          state={flow.state}
          labels={labels}
          detailsText={detailsTextOf(labels, values)}
          onClose={onClose}
          after={
            flow.state.phase === "done" ? (
              <p>
                <PageLink href={opened.universityId ? `/apply?university=${encodeURIComponent(opened.universityId)}` : "/apply"}>{labels.completeApplication}</PageLink>
              </p>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <form className="lead-panel" onSubmit={submit} noValidate onFocus={flow.preload}>
      <h2 id="quick-title">{labels.quickTitle}</h2>
      <p className="muted">{labels.quickIntro}</p>

      {universityName && (opened.universityId || opened.programmeId) ? <p className="notice">{fillTemplate(labels.quickAbout, { university: universityName })}</p> : null}
      {!opened.universityId && !opened.programmeId ? (
        <Field id="quick-university" label={labels.university} error={errorText(labels, errors.university ?? errors["source.university_id"])}>
          <select id="quick-university" value={chosenUniversity} onChange={(e) => setChosenUniversity(e.target.value)} required aria-invalid={Boolean(errors.university)} aria-describedby={describedBy("quick-university", false, Boolean(errors.university))}>
            <option value="">{labels.chooseUniversity}</option>
            {universities.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      <Field id="quick-name" label={labels.name} error={errorText(labels, errors.name)}>
        <input id="quick-name" type="text" autoComplete="name" value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} required maxLength={100} aria-invalid={Boolean(errors.name)} aria-describedby={describedBy("quick-name", false, Boolean(errors.name))} />
      </Field>
      <CountrySelect id="quick-country" value={values.country} onChange={(country) => setValues({ ...values, country })} labels={labels} error={errorText(labels, errors.country_code)} />
      <Field id="quick-whatsapp" label={labels.whatsapp} help={labels.whatsappHelp} error={errorText(labels, errors.whatsapp)}>
        <input id="quick-whatsapp" type="tel" inputMode="tel" autoComplete="tel" value={values.whatsapp} onChange={(e) => setValues({ ...values, whatsapp: e.target.value })} required aria-invalid={Boolean(errors.whatsapp)} aria-describedby={describedBy("quick-whatsapp", true, Boolean(errors.whatsapp))} />
      </Field>
      <ConsentField id="quick-consent" checked={values.consent} onChange={(consent) => setValues({ ...values, consent })} labels={labels} error={errorText(labels, errors.consent)} />

      <TurnstileBox hostRef={flow.hostRef} active={flow.interactive} labels={labels} />

      <div className="cta-row">
        <button type="submit" className="btn btn-whatsapp" disabled={busy}>
          {busy ? labels.saving : labels.continue}
        </button>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={busy}>
          {labels.cancel}
        </button>
      </div>
    </form>
  );
}
