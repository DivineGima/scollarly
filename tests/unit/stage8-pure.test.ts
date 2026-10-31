import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { OfflineCard } from "@/components/student/offline-card";
import { Offline } from "@/components/student/offline-view";
import { StudentShell } from "@/components/student/student-shell";
import { PIPELINE_STAGE_CODES } from "@/lib/constants";
import { erasureBody, readLinkInput, requestLinkBody, setNameBody } from "@/modules/student/endpoints";
import { canonicalShellPath, classifyAuthed } from "@/server/edge/authed";
import { isNeverCached } from "@/lib/sw-rules";

describe("A12: what the student typed is a reference or a number", () => {
  it("reads a reference in any case, with or without dashes", () => {
    expect(readLinkInput("sc-abcde-12345")).toEqual({ ref: "SC-ABCDE-12345" });
    expect(readLinkInput(" SC ABCDE 12345 ")).toEqual({ ref: "SC-ABCDE-12345" });
    expect(readLinkInput("SCABCDE12345")).toEqual({ ref: "SC-ABCDE-12345" });
  });

  it("reads an international number, with spaces, dashes and the 00 prefix", () => {
    expect(readLinkInput("+237 651 232 301")).toEqual({ number: "+237651232301" });
    expect(readLinkInput("00237-651-232-301")).toEqual({ number: "+237651232301" });
  });

  it("does not mistake a ten digit local number for a reference", () => {
    // `parseRef` would accept these ten characters as a reference body; a number never starts with SC.
    expect(readLinkInput("0201234567", "GH")).toEqual({ number: "+233201234567" });
    expect(readLinkInput("0803 123 4567", "NG")).toEqual({ number: "+2348031234567" });
  });

  it("asks for the country when a local number comes without one, and refuses what is neither", () => {
    expect(readLinkInput("0803 123 4567")).toEqual({ problem: "NEEDS_COUNTRY" });
    expect(readLinkInput("hello")).toEqual({ problem: "INVALID" });
    expect(readLinkInput("SC-12")).toEqual({ problem: "INVALID" });
    // Crockford reading (O is 0, I and L are 1) is kept: a student who types an O for a zero still finds the application.
    expect(readLinkInput("SC-ILLEG-AL0O1")).toEqual({ ref: "SC-111EG-A1001" });
    expect(readLinkInput("SC-UUUUU-UUUUU")).toEqual({ problem: "INVALID" });
    expect(readLinkInput("+1")).toEqual({ problem: "INVALID" });
  });
});

describe("the bodies of the student operations are strict", () => {
  it("a link request is one text and an optional country", () => {
    expect(requestLinkBody.safeParse({ reference: "SC-ABCDE-12345" }).success).toBe(true);
    expect(requestLinkBody.safeParse({ reference: "0201234567", country: "GH" }).success).toBe(true);
    expect(requestLinkBody.safeParse({ reference: "x", country: "FR" }).success).toBe(false);
    expect(requestLinkBody.safeParse({ reference: "x", leadId: "1" }).success).toBe(false);
    expect(requestLinkBody.safeParse({ reference: "x".repeat(41) }).success).toBe(false);
  });

  it("erasure needs exactly the word DELETE, and a name is trimmed and limited", () => {
    expect(erasureBody.safeParse({ confirm: "DELETE" }).success).toBe(true);
    for (const confirm of ["delete", "Delete", " DELETE", "yes", ""]) expect(erasureBody.safeParse({ confirm }).success, confirm).toBe(false);
    expect(setNameBody.parse({ name: "  Ama  " }).name).toBe("Ama");
    expect(setNameBody.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
});

describe("the portal's screens are student screens", () => {
  it("every /me address is a shell for any signed-in user, and a data call lives under /api/v1/me", () => {
    for (const path of ["/me", "/me/link-application", "/me/profile", "/me/data", "/en/me", "/en/me/data"]) {
      expect(classifyAuthed("GET", new URL(`https://x.example${path}`), new Headers()), path).toEqual({ kind: "shell", area: "me" });
      expect(canonicalShellPath(path), path).toBe(path);
    }
    expect(classifyAuthed("GET", new URL("https://x.example/api/v1/me/progress"), new Headers())).toEqual({ kind: "api", area: "me", name: "progress" });
    expect(classifyAuthed("GET", new URL("https://x.example/api/v1/me/profile"), new Headers())).toEqual({ kind: "api", area: "me", name: "profile" });
  });

  it("the service worker never keeps /me, its pages or its data (architecture 11.1)", () => {
    for (const path of ["/me", "/me/data", "/en/me/profile", "/api/v1/me/progress"]) expect(isNeverCached(path), path).toBe(true);
    // The offline copy is not a page: /offline is what the service worker serves.
    expect(isNeverCached("/offline")).toBe(false);
  });
});

describe("the six stages have words for every student", () => {
  it("each stage has a name and a next step, in English and in French", () => {
    for (const messages of [en, fr]) {
      for (const code of PIPELINE_STAGE_CODES) {
        expect(messages.me.stages[code as keyof typeof messages.me.stages], code).toBeTruthy();
        expect(messages.me.next[code as keyof typeof messages.me.next], code).toBeTruthy();
      }
    }
  });
});

describe("S8.1 the offline copy and the frame", () => {
  const Provider = NextIntlClientProvider as unknown as React.FC<{ locale: string; messages: object; children?: React.ReactNode }>;
  const render = (node: React.ReactNode, messages: object = en) => renderToStaticMarkup(createElement(Provider, { locale: "en", messages }, node));

  it("shows the last stage kept on the phone with the date, and nothing else about the person", () => {
    const html = render(createElement(Offline, { snapshot: { userId: "u1", leadRef: "SC-ABCDE-12345", stageCode: "offer_letter", updatedAt: Date.UTC(2026, 9, 24, 12) } }));
    expect(html).toContain("SC-ABCDE-12345");
    expect(html).toContain("Offer letter");
    expect(html).toContain("Last updated 2026-10-24");
    expect(html).toContain("<h1>");
    expect(html).not.toContain("u1");
  });

  it("under another page's heading it uses a second level heading, and offers no retry unless asked", () => {
    const labels = { title: "My application", body: "You're offline.", reference: "Your reference", stage: "Step", lastUpdated: "Last updated {date}" };
    const html = renderToStaticMarkup(createElement(OfflineCard, { snapshot: { userId: "u1", leadRef: "SC-ABCDE-12345", stageCode: "visa", updatedAt: Date.UTC(2026, 9, 24) }, labels, stageName: "Visa", embedded: true }));
    expect(html).toContain("<h2>");
    expect(html).not.toContain("<h1>");
    expect(html).not.toContain("<button");
    expect(html).toContain("Last updated 2026-10-24");
    expect(html).not.toContain("u1");
  });

  it("the same in French, with the stage name in French", () => {
    const html = render(createElement(Offline, { snapshot: { userId: "u1", leadRef: "SC-ABCDE-12345", stageCode: "offer_letter", updatedAt: Date.UTC(2026, 9, 24) } }), fr);
    expect(html).toContain("Lettre d&#x27;admission");
  });

  it("the frame has the four tabs, the More button and a skip link (S13.4; the profile, data and sign-out links are in the More sheet)", () => {
    const html = render(createElement(StudentShell, null, createElement("p", null, "inside")));
    for (const href of ['href="/me"', 'href="/me/universities"', 'href="/me/progress"', 'href="/me/help"', 'href="#main"']) expect(html, href).toContain(href);
    expect(html).toContain('aria-label="More"');
    expect(html).toContain("inside");
  });
});
