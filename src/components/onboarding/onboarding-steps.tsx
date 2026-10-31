"use client";

import { useTranslations } from "next-intl";
import { MAX_COURSE_FIELDS, QUALIFICATION_TYPES, STUDENT_COUNTRIES, STUDY_LEVELS } from "@/lib/constants";
import { COURSE_FIELDS } from "@/lib/courses";
import { type OnboardingValues } from "@/modules/onboarding/payload";
import type { StepKey } from "@/modules/onboarding/questions";
import { intakeYears, RESULTS_MAX, type AnswerErrors } from "@/modules/onboarding/validate";

/**
 * The screens of the questionnaire (architecture 21.6). Each is a plain form group: labels on every field, the error under the field it
 * belongs to, thumb-sized targets, and no script beyond React. The words are `onboarding.<step>.*`; the rules are in `modules/onboarding`.
 */

export interface StepProps {
  values: OnboardingValues;
  errors: AnswerErrors;
  set: (patch: Partial<OnboardingValues>) => void;
  now: Date;
}

function FieldError({ id, token }: { id: string; token: string | undefined }) {
  const t = useTranslations("onboarding.errors");
  return token ? (
    <p id={id} className="me-error">
      {t(token)}
    </p>
  ) : null;
}

function CountrySelect({ id, value, error, onChange }: { id: string; value: string; error: string | undefined; onChange: (value: string) => void }) {
  const t = useTranslations("onboarding");
  return (
    <>
      <select id={id} value={value} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("choose")}</option>
        {STUDENT_COUNTRIES.map((code) => (
          <option key={code} value={code}>
            {t(`countries.${code}`)}
          </option>
        ))}
      </select>
      <FieldError id={`${id}-error`} token={error} />
    </>
  );
}

function TextField({ id, label, hint, value, error, type = "text", autoComplete, onChange }: { id: string; label: string; hint?: string; value: string; error: string | undefined; type?: string; autoComplete?: string; onChange: (value: string) => void }) {
  return (
    <div className="me-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        inputMode={type === "tel" ? "tel" : undefined}
        maxLength={100}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && !error ? (
        <p id={`${id}-hint`} className="me-muted">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} token={error} />
    </div>
  );
}

function Basics({ values, errors, set }: StepProps) {
  const t = useTranslations("onboarding.basics");
  return (
    <>
      <p>{t("intro")}</p>
      <TextField id="ob-name" label={t("name")} value={values.applicant_name} error={errors.applicant_name} autoComplete="name" onChange={(applicant_name) => set({ applicant_name })} />
      <div className="me-field">
        <label htmlFor="ob-country">{t("country")}</label>
        <CountrySelect id="ob-country" value={values.applicant_country} error={errors.applicant_country} onChange={(applicant_country) => set({ applicant_country })} />
      </div>
      <TextField id="ob-whatsapp" type="tel" label={t("whatsapp")} hint={t("whatsappHint")} value={values.contact_whatsapp} error={errors.contact_whatsapp} autoComplete="tel" onChange={(contact_whatsapp) => set({ contact_whatsapp })} />
    </>
  );
}

function Who({ values, errors, set }: StepProps) {
  const t = useTranslations("onboarding.who");
  return (
    <>
      <p>{t("intro")}</p>
      <TextField id="ob-name" label={t("name")} value={values.applicant_name} error={errors.applicant_name} onChange={(applicant_name) => set({ applicant_name })} />
      <div className="me-field">
        <label htmlFor="ob-country">{t("country")}</label>
        <CountrySelect id="ob-country" value={values.applicant_country} error={errors.applicant_country} onChange={(applicant_country) => set({ applicant_country })} />
      </div>
    </>
  );
}

function Results({ values, errors, set }: StepProps) {
  const t = useTranslations("onboarding.results");
  const rows = values.results;
  const update = (index: number, patch: Partial<{ subject: string; grade: string }>) =>
    set({ results: rows.map((row, i) => (i === index ? { ...row, ...patch } : row)) });
  return (
    <>
      <p>{t("intro")}</p>
      <fieldset className="ob-choices">
        <legend>{t("qualification")}</legend>
        {QUALIFICATION_TYPES.map((type) => (
          <label key={type} className="ob-choice">
            <input type="radio" name="ob-qualification" value={type} checked={values.qualification_type === type} onChange={() => set({ qualification_type: type })} />
            <span>{t(`qualifications.${type}`)}</span>
          </label>
        ))}
        <FieldError id="ob-qualification-error" token={errors.qualification_type} />
      </fieldset>
      <fieldset className="ob-choices">
        <legend>{t("grades")}</legend>
        <p className="me-muted">{t("gradesHint")}</p>
        {rows.map((row, index) => (
          <div key={index} className="ob-row">
            <div className="me-field">
              <label htmlFor={`ob-subject-${index}`}>{t("subject")}</label>
              <input id={`ob-subject-${index}`} value={row.subject} maxLength={60} onChange={(e) => update(index, { subject: e.target.value })} />
            </div>
            <div className="me-field">
              <label htmlFor={`ob-grade-${index}`}>{t("grade")}</label>
              <input id={`ob-grade-${index}`} value={row.grade} maxLength={10} onChange={(e) => update(index, { grade: e.target.value })} />
            </div>
            <button type="button" className="me-button me-button-quiet" onClick={() => set({ results: rows.filter((_, i) => i !== index) })}>
              {t("remove")}
            </button>
          </div>
        ))}
        <FieldError id="ob-results-error" token={errors.results} />
        {rows.length < RESULTS_MAX ? (
          <button type="button" className="me-button me-button-quiet" onClick={() => set({ results: [...rows, { subject: "", grade: "" }] })}>
            {t("add")}
          </button>
        ) : null}
      </fieldset>
    </>
  );
}

function Plan({ values, errors, set, now }: StepProps) {
  const t = useTranslations("onboarding.plan");
  const tc = useTranslations("courses");
  const full = values.course_fields.length >= MAX_COURSE_FIELDS;
  const toggle = (code: string) =>
    set({ course_fields: values.course_fields.includes(code) ? values.course_fields.filter((c) => c !== code) : [...values.course_fields, code] });
  return (
    <>
      <p>{t("intro")}</p>
      <fieldset className="ob-choices">
        <legend>{t("level")}</legend>
        {STUDY_LEVELS.map((level) => (
          <label key={level} className="ob-choice">
            <input type="radio" name="ob-level" value={level} checked={values.level === level} onChange={() => set({ level })} />
            <span>{t(`levels.${level}`)}</span>
          </label>
        ))}
        <FieldError id="ob-level-error" token={errors.level} />
      </fieldset>
      <fieldset className="ob-choices">
        <legend>{t("courses", { max: MAX_COURSE_FIELDS })}</legend>
        {COURSE_FIELDS.map((code) => {
          const checked = values.course_fields.includes(code);
          return (
            <label key={code} className="ob-choice">
              <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => toggle(code)} />
              <span>{tc(code)}</span>
            </label>
          );
        })}
        <FieldError id="ob-courses-error" token={errors.course_fields} />
      </fieldset>
      <div className="me-field">
        <label htmlFor="ob-year">{t("year")}</label>
        <select id="ob-year" value={values.intake_year ?? ""} aria-invalid={errors.intake_year ? true : undefined} onChange={(e) => set({ intake_year: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t("choose")}</option>
          {intakeYears(now).map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </select>
        <FieldError id="ob-year-error" token={errors.intake_year} />
      </div>
    </>
  );
}

function Contact({ values, errors, set }: StepProps) {
  const t = useTranslations("onboarding.contact");
  return (
    <>
      <p>{t("intro")}</p>
      <TextField id="ob-contact-name" label={t("name")} value={values.contact_name} error={errors.contact_name} autoComplete="name" onChange={(contact_name) => set({ contact_name })} />
      <div className="me-field">
        <label htmlFor="ob-contact-country">{t("country")}</label>
        <CountrySelect id="ob-contact-country" value={values.contact_country} error={errors.contact_country} onChange={(contact_country) => set({ contact_country })} />
      </div>
      <TextField id="ob-whatsapp" type="tel" label={t("whatsapp")} hint={t("whatsappHint")} value={values.contact_whatsapp} error={errors.contact_whatsapp} autoComplete="tel" onChange={(contact_whatsapp) => set({ contact_whatsapp })} />
    </>
  );
}

function Consent({ values, errors, set }: StepProps) {
  const t = useTranslations("onboarding.consent");
  return (
    <>
      <p>{t("intro")}</p>
      <label className="ob-choice">
        <input type="checkbox" checked={values.consent} aria-invalid={errors.consent ? true : undefined} aria-describedby={errors.consent ? "ob-consent-error" : undefined} onChange={(e) => set({ consent: e.target.checked })} />
        <span>
          {t("tick")}{" "}
          <a href="/privacy" target="_blank" rel="noopener noreferrer">
            {t("privacy")}
          </a>
        </span>
      </label>
      <FieldError id="ob-consent-error" token={errors.consent} />
    </>
  );
}

export function StepBody({ step, ...props }: StepProps & { step: StepKey }) {
  switch (step) {
    case "basics":
      return <Basics {...props} />;
    case "who":
      return <Who {...props} />;
    case "results":
      return <Results {...props} />;
    case "plan":
      return <Plan {...props} />;
    case "contact":
      return <Contact {...props} />;
    case "consent":
      return <Consent {...props} />;
  }
}
