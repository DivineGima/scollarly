"use client";

import { useId, useMemo, useState } from "react";
import type { CourseField } from "@/lib/courses";
import { findUniversitiesByCourse, signUpHrefForCourse } from "@/modules/content/course-finder";
import type { CatalogueEntry } from "@/modules/student/ordering";

export interface CourseFinderLabels {
  heading: string;
  label: string;
  choose: string;
  prompt: string;
  /** Contains `{count}`. */
  countOne: string;
  /** Contains `{count}`. */
  countOther: string;
  none: string;
  cta: string;
  ctaHint: string;
  /** Contains `{grade}`. */
  naac: string;
  naacMissing: string;
  /** Contains `{name}`. */
  open: string;
}

/**
 * The one script on the landing page (architecture 21.12): pick a course, see the universities that offer it. The catalogue is embedded in
 * the page, so choosing needs no request and works offline. It is hidden with JavaScript off (the university list below it is the fallback).
 * "Create your free account" carries the course into sign-up and from there into onboarding. A course no university lists yet says so
 * and points to the same button (FR-31), so no choice ever ends on an empty screen. Chat lives inside the account (PRD_4 F26).
 */
export function CourseFinder({
  catalogue,
  fields,
  courseNames,
  labels,
}: {
  catalogue: readonly CatalogueEntry[];
  fields: readonly CourseField[];
  courseNames: Readonly<Record<string, string>>;
  labels: CourseFinderLabels;
}) {
  const selectId = useId();
  const [field, setField] = useState("");
  const results = useMemo(() => findUniversitiesByCourse(catalogue, field), [catalogue, field]);

  return (
    <section className="finder js-only" aria-labelledby="finder-heading" data-testid="course-finder">
      <h2 id="finder-heading">{labels.heading}</h2>
      <label htmlFor={selectId}>{labels.label}</label>
      <select id={selectId} value={field} onChange={(event) => setField(event.target.value)}>
        <option value="">{labels.choose}</option>
        {fields.map((code) => (
          <option key={code} value={code}>
            {courseNames[code] ?? code}
          </option>
        ))}
      </select>
      <div role="status" aria-live="polite" className="finder-result">
        {field === "" ? (
          <p className="muted">{labels.prompt}</p>
        ) : results.length === 0 ? (
          <p data-testid="finder-none">{labels.none}</p>
        ) : (
          <>
            <p data-testid="finder-count">{(results.length === 1 ? labels.countOne : labels.countOther).replace("{count}", String(results.length))}</p>
            <ul className="finder-list">
              {results.map((university) => (
                <li key={university.slug} data-testid="finder-university">
                  <a href={`/universities/${university.slug}`} aria-label={labels.open.replace("{name}", university.name)}>
                    <strong>{university.name}</strong>
                  </a>
                  <span className="muted">
                    {university.city ? `${university.city} · ` : ""}
                    {university.naacGrade ? labels.naac.replace("{grade}", university.naacGrade) : labels.naacMissing}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <p className="cta-row">
        <a className="btn btn-primary" href={signUpHrefForCourse(field)} data-account-link data-testid="finder-cta">
          {labels.cta}
        </a>
      </p>
      <p className="muted">{labels.ctaHint}</p>
    </section>
  );
}
