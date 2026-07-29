"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

const STEPS = [
  { targetId: "process", titleKey: "step_2_title", bodyKey: "step_2_body" },
  { targetId: "universities", titleKey: "step_3_title", bodyKey: "step_3_body" },
  { targetId: "services", titleKey: "step_4_title", bodyKey: "step_4_body" },
  { targetId: "stories", titleKey: "step_5_title", bodyKey: "step_5_body" },
  { targetId: "faq", titleKey: "step_6_title", bodyKey: "step_6_body" },
  { targetId: "contact", titleKey: "step_7_title", bodyKey: "step_7_body" },
] as const;

const SEEN_KEY = "scollarly_tour_seen";
const SPOTLIGHT_PADDING = 12;

type Rect = { top: number; left: number; width: number; height: number };

export function ProductTour() {
  const t = useTranslations("ProductTour");
  const [isOpen, setIsOpen] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);

  const measure = useCallback(() => {
    const step = STEPS[stepIndex];
    const target = document.getElementById(step.targetId);
    if (!target) return;
    const box = target.getBoundingClientRect();
    setRect({
      top: box.top - SPOTLIGHT_PADDING,
      left: box.left - SPOTLIGHT_PADDING,
      width: box.width + SPOTLIGHT_PADDING * 2,
      height: box.height + SPOTLIGHT_PADDING * 2,
    });
  }, [stepIndex]);

  useEffect(() => {
    if (!isOpen) return;
    const target = document.getElementById(STEPS[stepIndex].targetId);
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "start" });
    const raf = requestAnimationFrame(measure);

    const timeout = setTimeout(measure, 450);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [isOpen, stepIndex, measure]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!window.localStorage.getItem(SEEN_KEY)) {
      const timeout = setTimeout(() => {
        window.localStorage.setItem(SEEN_KEY, "1");
        setStepIndex(0);
        setIsOpen(true);
      }, 1500);
      return () => clearTimeout(timeout);
    }
  }, []);

  const startTour = () => {
    setStepIndex(0);
    setIsOpen(true);
  };

  const closeTour = () => {
    setIsOpen(false);
    setRect(null);
  };

  const isLastStep = stepIndex === STEPS.length - 1;
  const step = STEPS[stepIndex];

  return (
    <>
      <button
        onClick={startTour}
        className="fixed bottom-6 left-6 z-40 inline-flex items-center gap-2 px-5 h-12 rounded-full bg-neutral-900 text-white text-sm font-semibold shadow-lg shadow-black/20 hover:bg-neutral-800 transition-all duration-300 hover:-translate-y-0.5"
      >
        <span aria-hidden>🧭</span>
        {t("trigger_button")}
      </button>

      {isOpen && rect && (
        <>
          <div
            className="fixed z-50 rounded-xl pointer-events-none transition-all duration-500 ease-out"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height,
              boxShadow: "0 0 0 9999px rgba(10, 10, 12, 0.8)",
              outline: "2px solid #3b82f6",
              outlineOffset: "2px",
            }}
          />

          <div className="fixed inset-x-0 bottom-0 sm:bottom-6 z-50 flex justify-center px-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl p-6 relative mb-4 sm:mb-0">
              <button
                onClick={closeTour}
                aria-label={t("close_aria")}
                className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 transition-colors"
              >
                ✕
              </button>

              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold tracking-wide uppercase bg-blue-100 text-blue-800 mb-4">
                {t("step_label", { current: stepIndex + 1, total: STEPS.length })}
              </span>

              <h3 className="text-xl font-bold text-neutral-900 mb-2">{t(step.titleKey)}</h3>
              <p className="text-neutral-600 leading-relaxed mb-6">{t(step.bodyKey)}</p>

              <div className="flex items-center gap-1.5 mb-6">
                {STEPS.map((s, i) => (
                  <span
                    key={s.targetId}
                    className={`h-1.5 rounded-full transition-all duration-300 ${
                      i === stepIndex ? "w-6 bg-blue-600" : "w-1.5 bg-neutral-200"
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  onClick={closeTour}
                  className="text-sm font-medium text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  {t("skip_button")}
                </button>
                <div className="flex items-center gap-2">
                  {stepIndex > 0 && (
                    <button
                      onClick={() => setStepIndex((i) => Math.max(0, i - 1))}
                      className="px-4 h-10 rounded-lg text-sm font-semibold text-neutral-700 border border-neutral-200 hover:bg-neutral-50 transition-colors"
                    >
                      {t("prev_button")}
                    </button>
                  )}
                  <button
                    onClick={() => (isLastStep ? closeTour() : setStepIndex((i) => i + 1))}
                    className="px-5 h-10 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                  >
                    {isLastStep ? t("done_button") : t("next_button")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
