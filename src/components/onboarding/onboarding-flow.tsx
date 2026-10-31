"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- signed-in screens are cached shells plus a data call, so leaving one is a full page load on purpose (ADR-040) */

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { generateRef } from "@/lib/ref";
import { randomUuid } from "@/lib/uuid";
import { buildOnboardingPayload, courseFromSearch, type OnboardingValues } from "@/modules/onboarding/payload";
import { firstIncompleteStep, progressOf, STEPS_FOR, type StepKey, validateStep } from "@/modules/onboarding/questions";
import { type AnswerErrors, relationshipOf } from "@/modules/onboarding/validate";
import type { OnboardingDraft } from "@/offline/db";
import { enqueueLead, listLeads, removeLead } from "@/offline/lead-queue";
import { nextDueIn, type QueuedLead } from "@/offline/logic";
import { clearDraft, newDraft, readDraft, saveDraft } from "@/offline/onboarding-draft";
import { realOnboardingSyncDeps } from "@/offline/real-deps";
import { syncOnce } from "@/offline/sync-engine";
import { MeStatus, useMeData } from "@/components/student/use-me-data";
import { StepBody } from "./onboarding-steps";

interface OnboardingState {
  userId: string;
  onboarded: boolean;
  relationship: "student" | "parent" | null;
  ref: string | null;
}

type Phase =
  | { name: "loading" }
  | { name: "questions" }
  | { name: "sending" }
  /** Finished and saved on this phone, waiting for a connection or a session. `reason` is the last error code. */
  | { name: "queued"; reason: string | null }
  | { name: "rejected"; reason: string }
  | { name: "done"; ref: string };

const SAVE_DELAY_MS = 300;

/**
 * The questionnaire for a new student or parent (architecture 21.6, ADR-043). One screen per question group; the answers are kept on
 * the phone after every change and nothing is sent until the last screen. Finishing puts one item in the lead queue
 * (`kind = "onboarding"`, the same idempotency key every time) and sends it: online it arrives at once, offline it waits on the phone
 * and is sent when the connection returns, and a retry or a second device can never make a second lead.
 */
export function OnboardingFlow() {
  const t = useTranslations("onboarding");
  const { state, reload } = useMeData<OnboardingState>("/api/v1/me/onboarding-state");

  if (state.status !== "ready") return <MeStatus state={state} reload={reload} />;
  if (state.data.onboarded) {
    return (
      <section className="me-card" aria-labelledby="ob-done-title">
        <h1 id="ob-done-title">{t("already.title")}</h1>
        <p>{t("already.body")}</p>
        {state.data.ref ? <p className="ob-ref">{t("sent.ref", { ref: state.data.ref })}</p> : null}
        <a className="me-button" href="/me">
          {t("sent.go")}
        </a>
      </section>
    );
  }
  return <Questionnaire userId={state.data.userId} />;
}

function Questionnaire({ userId }: { userId: string }) {
  const t = useTranslations("onboarding");
  const locale = useLocale();
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [errors, setErrors] = useState<AnswerErrors>({});
  const [now] = useState(() => new Date());
  const heading = useRef<HTMLHeadingElement | null>(null);
  const loaded = useRef(false);
  const syncing = useRef(false);

  // Start from the draft on this phone if there is one, otherwise from the choice made at sign-up (`?as=` and `?course=`).
  useEffect(() => {
    let live = true;
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const saved = await readDraft(userId);
      const first = saved ?? newDraft(userId, relationshipOf(params.get("as")), courseFromSearch(window.location.search));
      const steps = STEPS_FOR[first.values.relationship];
      const started: OnboardingDraft = { ...first, step: steps.includes(first.step as StepKey) ? first.step : (steps[0] as string) };
      const waiting = (await safeList()).find((item) => item.kind === "onboarding");
      if (!live) return;
      setDraft(started);
      loaded.current = true;
      setPhase(waiting ? { name: "queued", reason: waiting.lastError } : { name: "questions" });
    })();
    return () => {
      live = false;
    };
  }, [userId]);

  // Keep the answers on the phone after every change (a short pause, so typing is not a write per letter), at once when the screen
  // changes, and when the page is hidden or closed, so leaving halfway never loses the last words typed.
  const latest = useRef<OnboardingDraft | null>(null);
  const savedStep = useRef<string | null>(null);
  useEffect(() => {
    latest.current = draft;
    if (!loaded.current || !draft || phase.name !== "questions") return;
    const stepChanged = savedStep.current !== null && savedStep.current !== draft.step;
    savedStep.current = draft.step;
    if (stepChanged) {
      void saveDraft({ ...draft, updatedAt: Date.now() });
      return;
    }
    const timer = setTimeout(() => void saveDraft({ ...draft, updatedAt: Date.now() }), SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, phase.name]);

  useEffect(() => {
    const flush = () => {
      if (loaded.current && latest.current && document.visibilityState !== "visible") void saveDraft({ ...latest.current, updatedAt: Date.now() });
    };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, []);

  useEffect(() => {
    if (phase.name === "questions") heading.current?.focus();
  }, [draft?.step, phase.name]);

  const runSync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    let sentRef: string | null = null;
    try {
      if (navigator.onLine) {
        await syncOnce(realOnboardingSyncDeps((_item, result) => (sentRef = result.ref)));
      }
      const left = (await safeList()).find((item) => item.kind === "onboarding");
      if (!left) {
        // The server has it (or another device already finished): the draft is no longer needed.
        await clearDraft();
        setPhase({ name: "done", ref: sentRef ?? "" });
      } else if (left.status === "failed") {
        setPhase({ name: "rejected", reason: left.lastError ?? "REJECTED" });
      } else {
        setPhase({ name: "queued", reason: navigator.onLine ? left.lastError : "NETWORK" });
      }
    } finally {
      syncing.current = false;
    }
  }, []);

  // While a finished questionnaire waits on the phone, try again when the connection returns, the tab is shown, and at the next due time.
  useEffect(() => {
    if (phase.name !== "queued") return;
    const retry = () => void runSync();
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    let timer: ReturnType<typeof setTimeout> | undefined;
    void safeList().then((items) => {
      const wait = nextDueIn(items.filter((item) => item.kind === "onboarding"), Date.now());
      if (wait !== null) timer = setTimeout(retry, Math.min(Math.max(wait, 1_000), 3_600_000));
    });
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
      if (timer) clearTimeout(timer);
    };
  }, [phase.name, runSync]);

  const setStep = (step: StepKey) => {
    setErrors({});
    setDraft((current) => (current ? { ...current, step } : current));
  };
  const set = (patch: Partial<OnboardingValues>) => {
    setDraft((current) => (current ? { ...current, values: { ...current.values, ...patch } } : current));
    // A field is no longer wrong once it is being corrected.
    setErrors((current) => {
      const next = { ...current };
      for (const key of Object.keys(patch)) delete next[key as keyof AnswerErrors];
      return next;
    });
  };

  if (phase.name === "loading" || !draft) return <p role="status">{t("loading")}</p>;

  const values = draft.values;
  const steps = STEPS_FOR[values.relationship];
  const step = draft.step as StepKey;
  const index = steps.indexOf(step);
  const last = index === steps.length - 1;
  const { position, total } = progressOf(values.relationship, step);

  function next() {
    const found = validateStep(step, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    // The contact's number is checked against a country; a parent's defaults to the child's.
    if (steps[index + 1] === "contact" && !values.contact_country) set({ contact_country: values.applicant_country });
    setStep(steps[index + 1] as StepKey);
  }

  async function finish() {
    const incomplete = firstIncompleteStep(values.relationship, values);
    if (incomplete) {
      setErrors(validateStep(incomplete, values));
      if (incomplete !== step) setStep(incomplete);
      return;
    }
    if (!draft) return;
    setPhase({ name: "sending" });
    const payload = buildOnboardingPayload(values, { locale, ref: draft.ref });
    const timestamp = Date.now();
    const item: QueuedLead = { kind: "onboarding", key: draft.key || randomUuid(), payload, ref: draft.ref, createdAt: timestamp, attempts: 0, lastError: null, status: "pending", nextAttemptAt: 0, updatedAt: timestamp };
    try {
      await enqueueLead(item);
    } catch {
      // No storage on this phone (some private windows): the questionnaire cannot wait offline, so say so instead of pretending.
      setPhase({ name: "rejected", reason: "NO_STORAGE" });
      return;
    }
    await runSync();
  }

  if (phase.name === "done") {
    return (
      <section className="me-card" aria-labelledby="ob-done-title">
        <h1 id="ob-done-title" ref={heading} tabIndex={-1}>
          {t("sent.title")}
        </h1>
        <p>{t("sent.body")}</p>
        {phase.ref ? <p className="ob-ref">{t("sent.ref", { ref: phase.ref })}</p> : null}
        <a className="me-button" href="/me">
          {t("sent.go")}
        </a>
      </section>
    );
  }

  if (phase.name === "queued") {
    const message = phase.reason === "UNAUTHENTICATED" ? t("queued.signIn") : phase.reason === "NUMBER_LIMIT" ? t("queued.numberLimit") : phase.reason === "NETWORK" || phase.reason === null ? t("queued.offline") : t("queued.retry");
    return (
      <section className="me-card" aria-labelledby="ob-queued-title">
        <h1 id="ob-queued-title">{t("queued.title")}</h1>
        <p role="status">{message}</p>
        {phase.reason === "UNAUTHENTICATED" ? (
          <a className="me-button" href="/sign-in">
            {t("queued.signInButton")}
          </a>
        ) : (
          <button type="button" className="me-button" onClick={() => void runSync()}>
            {t("queued.tryNow")}
          </button>
        )}
      </section>
    );
  }

  if (phase.name === "rejected") {
    return (
      <section className="me-card" aria-labelledby="ob-rejected-title">
        <h1 id="ob-rejected-title">{t("rejected.title")}</h1>
        <p role="alert">{phase.reason === "NO_STORAGE" ? t("rejected.noStorage") : t("rejected.body")}</p>
        <button
          type="button"
          className="me-button"
          onClick={async () => {
            // Take the unsent copy off the queue so the person can correct the answers and send again. The server stored nothing for it,
            // so a fresh key and reference are right: reusing the old key with changed answers would be refused as a reused key.
            const item = (await safeList()).find((i) => i.kind === "onboarding");
            if (item) await removeLead(item.key).catch(() => undefined);
            setDraft((current) => (current ? { ...current, key: randomUuid(), ref: generateRef() } : current));
            setStep(steps[0] as StepKey);
            setPhase({ name: "questions" });
          }}
        >
          {t("rejected.review")}
        </button>
      </section>
    );
  }

  return (
    <section className="ob" aria-labelledby="ob-title">
      <p className="ob-progress-label" id="ob-progress-label">
        {t("progress", { position, total })}
      </p>
      <progress className="ob-progress" max={total} value={position} aria-labelledby="ob-progress-label" />
      <h1 id="ob-title" ref={heading} tabIndex={-1}>
        {t(`${step}.title`)}
      </h1>
      <p className="me-muted ob-saved">{t("savedOnPhone")}</p>
      {Object.keys(errors).length > 0 ? (
        <p role="alert" className="me-notice me-notice-error">
          {t("fixErrors")}
        </p>
      ) : null}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (last) void finish();
          else next();
        }}
      >
        <StepBody step={step} values={values} errors={errors} set={set} now={now} />
        <div className="me-actions ob-actions">
          {index > 0 ? (
            <button type="button" className="me-button me-button-quiet" onClick={() => setStep(steps[index - 1] as StepKey)}>
              {t("back")}
            </button>
          ) : null}
          <button type="submit" className="me-button" disabled={phase.name === "sending"}>
            {phase.name === "sending" ? t("sending") : last ? t("finish") : t("next")}
          </button>
        </div>
      </form>
    </section>
  );
}

async function safeList(): Promise<QueuedLead[]> {
  try {
    return await listLeads();
  } catch {
    return [];
  }
}
