import { getTranslations } from "next-intl/server";
import type { JourneyView, TeamMemberView, TestimonialView, TrustStatView } from "@/modules/content/types";
import { MediaImage } from "./media-image";

/**
 * Trust components (S3.4). Each renders nothing at all when it has nothing confirmed, so a page never shows an empty
 * "Our results" heading or a placeholder number. The data they receive is already filtered to confirmed figures,
 * verified and consented testimonials and confirmed bios (`modules/content/builders.ts`, FR-13, CLAUDE.md).
 */

export async function TrustStats({ stats }: { stats: TrustStatView[] }) {
  if (stats.length === 0) return null;
  const t = await getTranslations("trust");
  return (
    <section aria-labelledby="trust-stats-heading" className="section">
      <h2 id="trust-stats-heading" className="sr-only">
        {t("statsHeading")}
      </h2>
      <dl className="stats">
        {stats.map((stat) => (
          <div key={stat.key} className="stat">
            <dt>{stat.label}</dt>
            <dd>
              <span className="stat-value">{stat.value}</span>
              {stat.asOf ? <span className="muted small block">{t("asOf", { date: stat.asOf })}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export async function Testimonials({ items }: { items: TestimonialView[] }) {
  if (items.length === 0) return null;
  const t = await getTranslations("trust");
  return (
    <section aria-labelledby="testimonials-heading" className="section">
      <h2 id="testimonials-heading">{t("testimonialsHeading")}</h2>
      <ul className="grid cards">
        {items.map((item) => (
          <li key={item.id} className="card quote-card">
            <blockquote>
              <p>{item.quote}</p>
            </blockquote>
            <p className="quote-by">
              {item.photo ? <MediaImage media={item.photo} className="avatar" /> : null}
              <span>
                <strong>{item.studentName}</strong>
                <span className="muted block">{[item.country, item.universityName].filter(Boolean).join(" · ")}</span>
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function Journeys({ items }: { items: JourneyView[] }) {
  if (items.length === 0) return null;
  const t = await getTranslations("trust");
  return (
    <section aria-labelledby="journeys-heading" className="section">
      <h2 id="journeys-heading">{t("journeysHeading")}</h2>
      {items.map((journey) => (
        <article key={journey.id} className="card">
          <h3>{journey.studentName}</h3>
          <p className="muted">{[journey.country, journey.universityName].filter(Boolean).join(" · ")}</p>
          <p>{journey.summary}</p>
          {journey.steps.length > 0 ? (
            <ol className="journey-steps">
              {journey.steps.map((step) => (
                <li key={step.position}>
                  <strong>{step.title}</strong>
                  {step.dateLabel ? <span className="muted"> · {step.dateLabel}</span> : null}
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          ) : null}
        </article>
      ))}
    </section>
  );
}

export async function Team({ members }: { members: TeamMemberView[] }) {
  if (members.length === 0) return null;
  const t = await getTranslations("trust");
  return (
    <section aria-labelledby="team-heading" className="section">
      <h2 id="team-heading">{t("teamHeading")}</h2>
      <ul className="grid cards">
        {members.map((member) => (
          <li key={member.id} className="card">
            {member.photo ? <MediaImage media={member.photo} className="avatar avatar-large" /> : null}
            <h3>{member.name}</h3>
            <p className="muted">{member.roleTitle}</p>
            {member.bio ? <p>{member.bio}</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
