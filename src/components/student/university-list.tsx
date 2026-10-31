
import type { OrderedUniversity } from "@/modules/student/ordering";
import "./student.css";

export interface UniversityListLabels {
  /** Contains `{grade}`. */
  naac: string;
  /** Shown when the university has no NAAC grade yet. */
  naacMissing: string;
  /** Contains `{courses}`. */
  offers: string;
  /** Contains `{name}`; the link's accessible name. */
  open: string;
}

/**
 * The ordered universities (architecture 21.7). Plain markup with its words passed in, so the public `/offline` page can show it without
 * the translation runtime, and the signed-in screens use the same list. It holds no personal data: the order was made on the phone.
 */
export function UniversityList({ items, courseNames, labels }: { items: readonly OrderedUniversity[]; courseNames: Readonly<Record<string, string>>; labels: UniversityListLabels }) {
  return (
    <ol className="uni-list">
      {items.map((university) => (
        <li key={university.slug} className="uni-item" data-testid="university">
          <a href={`/universities/${university.slug}`} aria-label={labels.open.replace("{name}", university.name)}>
            <strong>{university.name}</strong>
          </a>
          <p className="uni-meta">
            {university.city ? <span>{university.city}</span> : null}
            <span data-testid="naac">{university.naacGrade ? labels.naac.replace("{grade}", university.naacGrade) : labels.naacMissing}</span>
          </p>
          {university.matches.length > 0 ? (
            <p className="uni-match" data-testid="match">
              {labels.offers.replace("{courses}", university.matches.map((field) => courseNames[field] ?? field).join(", "))}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
