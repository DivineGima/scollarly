"use client";

/* eslint-disable @next/next/no-html-link-for-pages -- signed-in screens are cached shells plus a data call, so leaving one is a full page load on purpose (ADR-040) */

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isCourseField } from "@/lib/courses";
import { generateRef } from "@/lib/ref";
import { randomUuid } from "@/lib/uuid";
import { MAX_PROGRAMMES, MIN_PROGRAMMES, orderProgrammes, type OrderedProgramme, type ProgrammeChoice } from "@/modules/applications/programmes";
import { enqueueLead, listLeads, removeLead } from "@/offline/lead-queue";
import { nextDueIn, type QueuedLead } from "@/offline/logic";
import { realApplicationSyncDeps } from "@/offline/real-deps";
import { syncOnce } from "@/offline/sync-engine";
import { MeStatus, useMeData } from "./use-me-data";

interface ApplicationContext {
  userId: string;
  onboarded: boolean;
  relationship: "student" | "parent" | null;
  firstName: string | null;
  courseFields: string[];
  lead: { ref: string; stage: string; updatedAt: string } | null;
}

type Phase =
  | { name: "choosing" }
  | { name: "sending" }
  /** Saved on this phone, waiting for a connection or a session. `reason` is the last error code. */
  | { name: "queued"; reason: string | null }
  | { name: "rejected"; reason: string }
  /** The server has it. `already` is true when the account had applied before (from another device), so the screen says so instead of "sent". */
  | { name: "done"; ref: string; already: boolean };

/**
 * The Apply screen (PRD_4 F24, architecture 23.3). The student's details come from the profile on the server; this screen asks only which
 * programmes, at least three, with the ones in their chosen courses first. The application is saved on the phone first and then sent with
 * the same idempotency key every time, so a retry, a second device or a double tap can never make a second application, and it works
 * offline: it waits on the phone and is sent when the connection returns.
 */
export function ApplyScreen({ programmes }: { programmes: readonly ProgrammeChoice[] }) {
  const { state, reload } = useMeData<ApplicationContext>("/api/v1/me/application-context");
  if (state.status !== "ready") return <MeStatus state={state} reload={reload} />;
  if (state.data.lead) return <AlreadyApplied lead={state.data.lead} />;
  return <Chooser programmes={programmes} courseFields={state.data.courseFields} />;
}

function AlreadyApplied({ lead }: { lead: { ref: string; stage: string } }) {
  const t = useTranslations("student.apply");
  const stages = useTranslations("me.stages");
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <section className="me-card" aria-labelledby="apply-already-title" data-testid="already-applied">
      <h1 id="apply-already-title" ref={heading} tabIndex={-1}>
        {t("already.title")}
      </h1>
      <p>{t("already.body")}</p>
      <p className="ob-ref">{t("ref", { ref: lead.ref })}</p>
      <p>{t("already.stage", { stage: stages.has(lead.stage) ? stages(lead.stage) : lead.stage })}</p>
      <a className="me-button" href="/me" data-testid="apply-go-home">
        {t("go")}
      </a>
    </section>
  );
}

function Chooser({ programmes, courseFields }: { programmes: readonly ProgrammeChoice[]; courseFields: readonly string[] }) {
  const t = useTranslations("student.apply");
  const courses = useTranslations("courses");
  const locale = useLocale();
  const ordered = useMemo(() => orderProgrammes(programmes, courseFields), [programmes, courseFields]);
  const [selected, setSelected] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ name: "choosing" });
  const [problem, setProblem] = useState<"min" | "max" | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const syncing = useRef(false);

  const runSync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    let sentRef: string | null = null;
    let already = false;
    try {
      if (navigator.onLine) {
        await syncOnce(
          realApplicationSyncDeps((_item, result) => {
            sentRef = result.ref;
            already = result.alreadyApplied === true;
          }),
        );
      }
      const left = (await safeList()).find((item) => item.kind === "application");
      if (!left) setPhase({ name: "done", ref: sentRef ?? "", already });
      else if (left.status === "failed") setPhase({ name: "rejected", reason: left.lastError ?? "REJECTED" });
      else setPhase({ name: "queued", reason: navigator.onLine ? left.lastError : "NETWORK" });
    } finally {
      syncing.current = false;
    }
  }, []);

  // An application that was saved on this phone and not yet sent (the person left, or the connection dropped): carry on with it, never ask twice.
  useEffect(() => {
    let live = true;
    void (async () => {
      const waiting = (await safeList()).find((item) => item.kind === "application");
      if (!live || !waiting) return;
      setPhase({ name: "queued", reason: waiting.lastError });
      void runSync();
    })();
    return () => {
      live = false;
    };
  }, [runSync]);

  // While an application waits on the phone, try again when the connection returns, the tab is shown, and at the next due time.
  useEffect(() => {
    if (phase.name !== "queued") return;
    const retry = () => void runSync();
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    let timer: ReturnType<typeof setTimeout> | undefined;
    void safeList().then((items) => {
      const wait = nextDueIn(items.filter((item) => item.kind === "application"), Date.now());
      if (wait !== null) timer = setTimeout(retry, Math.min(Math.max(wait, 1_000), 3_600_000));
    });
    return () => {
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
      if (timer) clearTimeout(timer);
    };
  }, [phase.name, runSync]);

  useEffect(() => {
    if (phase.name !== "choosing") heading.current?.focus();
  }, [phase.name]);

  function toggle(id: string) {
    setProblem(null);
    setSelected((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      if (current.length >= MAX_PROGRAMMES) {
        setProblem("max");
        return current;
      }
      return [...current, id];
    });
  }

  async function send() {
    if (selected.length < MIN_PROGRAMMES) {
      setProblem("min");
      return;
    }
    setPhase({ name: "sending" });
    const timestamp = Date.now();
    const clientRef = generateRef();
    const item: QueuedLead = {
      kind: "application",
      key: randomUuid(),
      payload: { programme_ids: selected, locale, client_ref: clientRef, client_created_at: new Date(timestamp).toISOString() },
      ref: clientRef,
      createdAt: timestamp,
      attempts: 0,
      lastError: null,
      status: "pending",
      nextAttemptAt: 0,
      updatedAt: timestamp,
    };
    try {
      await enqueueLead(item);
    } catch {
      // No storage on this phone (some private windows): the application cannot wait offline, so say so instead of pretending.
      setPhase({ name: "rejected", reason: "NO_STORAGE" });
      return;
    }
    await runSync();
  }

  if (phase.name === "done") {
    return (
      <section className="me-card" aria-labelledby="apply-done-title" data-testid="apply-done">
        <h1 id="apply-done-title" ref={heading} tabIndex={-1}>
          {phase.already ? t("already.title") : t("done.title")}
        </h1>
        <p>{phase.already ? t("already.body") : t("done.body")}</p>
        {phase.ref ? <p className="ob-ref">{t("ref", { ref: phase.ref })}</p> : null}
        <a className="me-button" href="/me" data-testid="apply-go-home">
          {t("go")}
        </a>
      </section>
    );
  }

  if (phase.name === "queued") {
    const message =
      phase.reason === "UNAUTHENTICATED"
        ? t("queued.signIn")
        : phase.reason === "NUMBER_LIMIT"
          ? t("queued.numberLimit")
          : phase.reason === "ONBOARDING_REQUIRED"
            ? t("queued.finishSignUp")
            : phase.reason === "NETWORK" || phase.reason === null
              ? t("queued.offline")
              : t("queued.retry");
    return (
      <section className="me-card" aria-labelledby="apply-queued-title" data-testid="apply-queued">
        <h1 id="apply-queued-title" ref={heading} tabIndex={-1}>
          {t("queued.title")}
        </h1>
        <p role="status">{message}</p>
        {phase.reason === "UNAUTHENTICATED" ? (
          <a className="me-button" href="/sign-in">
            {t("queued.signInButton")}
          </a>
        ) : phase.reason === "ONBOARDING_REQUIRED" ? (
          <a className="me-button" href="/me/onboarding">
            {t("queued.finishSignUpButton")}
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
      <section className="me-card" aria-labelledby="apply-rejected-title" data-testid="apply-rejected">
        <h1 id="apply-rejected-title" ref={heading} tabIndex={-1}>
          {t("rejected.title")}
        </h1>
        <p role="alert">{phase.reason === "NO_STORAGE" ? t("rejected.noStorage") : t("rejected.body")}</p>
        <button
          type="button"
          className="me-button"
          onClick={async () => {
            // Take the unsent copy off the queue so the person can correct the choice and send again. The server stored nothing for it, so a
            // fresh key is right: reusing the old key with changed programmes would be refused as a reused key.
            const item = (await safeList()).find((i) => i.kind === "application");
            if (item) await removeLead(item.key).catch(() => undefined);
            setPhase({ name: "choosing" });
          }}
        >
          {t("rejected.review")}
        </button>
      </section>
    );
  }

  if (programmes.length < MIN_PROGRAMMES) {
    return (
      <section className="me-card" aria-labelledby="apply-soon-title" data-testid="apply-soon">
        <h1 id="apply-soon-title">{t("title")}</h1>
        <p>{t("soon")}</p>
        <a className="me-button me-button-quiet" href="/me">
          {t("go")}
        </a>
      </section>
    );
  }

  const sending = phase.name === "sending";
  return (
    <section aria-labelledby="apply-title">
      <h1 id="apply-title" ref={heading} tabIndex={-1}>
        {t("title")}
      </h1>
      <p>{t("intro", { min: MIN_PROGRAMMES })}</p>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <fieldset className="apply-programmes" disabled={sending}>
          <legend>{t("legend")}</legend>
          <ul className="apply-list">
            {ordered.map((programme) => (
              <ProgrammeRow key={programme.id} programme={programme} rank={selected.indexOf(programme.id) + 1} onToggle={toggle} fieldName={programme.field && isCourseField(programme.field) ? courses(programme.field) : null} />
            ))}
          </ul>
        </fieldset>
        <p className="me-muted" role="status" data-testid="apply-count">
          {t("count", { count: selected.length, min: MIN_PROGRAMMES })}
        </p>
        {problem ? (
          <p role="alert" className="me-notice me-notice-error" data-testid="apply-problem">
            {problem === "min" ? t("minProgrammes", { min: MIN_PROGRAMMES }) : t("tooMany", { max: MAX_PROGRAMMES })}
          </p>
        ) : null}
        <div className="me-actions">
          <button type="submit" className="me-button" disabled={sending} data-testid="apply-send">
            {sending ? t("sending") : t("send")}
          </button>
        </div>
      </form>
    </section>
  );
}

function ProgrammeRow({ programme, rank, onToggle, fieldName }: { programme: OrderedProgramme; rank: number; onToggle: (id: string) => void; fieldName: string | null }) {
  const t = useTranslations("student.apply");
  const id = `programme-${programme.id}`;
  return (
    <li className="apply-row">
      <input id={id} type="checkbox" checked={rank > 0} onChange={() => onToggle(programme.id)} />
      <label htmlFor={id}>
        <span className="apply-name">{programme.name}</span>
        <span className="me-muted apply-meta">
          {programme.universityName}
          {fieldName ? ` · ${fieldName}` : ""}
        </span>
        {programme.suggested ? <span className="apply-tag">{t("suggested")}</span> : null}
        {rank > 0 ? <span className="apply-rank">{t("choice", { n: rank })}</span> : null}
      </label>
    </li>
  );
}

async function safeList(): Promise<QueuedLead[]> {
  try {
    return await listLeads();
  } catch {
    return [];
  }
}
