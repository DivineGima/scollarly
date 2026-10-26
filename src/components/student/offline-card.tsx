import type { ProgressSnapshot } from "@/offline/db";
import { watDateString } from "@/lib/time";

export interface OfflineCardLabels {
  title: string;
  body: string;
  reference: string;
  stage: string;
  /** Contains `{date}`. */
  lastUpdated: string;
  retry?: string;
}

/**
 * The last stage kept on this phone, with the date it was last known (A11 step 1, offline). Plain markup with its words passed in, so
 * the public `/offline` page can show it without loading the translation runtime: that page is saved on every visitor's phone, and
 * every kilobyte of it is paid for on a limited data plan. It holds only what the snapshot holds: a reference, a stage and a date.
 */
export function OfflineCard({
  snapshot,
  labels,
  stageName,
  retry,
  embedded = false,
}: {
  snapshot: ProgressSnapshot;
  labels: OfflineCardLabels;
  stageName: string;
  retry?: () => void;
  embedded?: boolean;
}) {
  const heading = embedded ? <h2>{labels.title}</h2> : <h1>{labels.title}</h1>;
  return (
    <section>
      {heading}
      <div className="me-card" data-testid="offline-progress">
        <p role="status">{labels.body}</p>
        <p>
          {labels.reference}: <strong>{snapshot.leadRef}</strong>
        </p>
        <p>
          {labels.stage}: <strong data-testid="offline-stage">{stageName}</strong>
        </p>
        <p className="me-muted" data-testid="offline-updated">
          {labels.lastUpdated.replace("{date}", watDateString(new Date(snapshot.updatedAt)))}
        </p>
        {retry && labels.retry ? (
          <button type="button" className="me-button me-button-quiet" onClick={retry}>
            {labels.retry}
          </button>
        ) : null}
      </div>
    </section>
  );
}
