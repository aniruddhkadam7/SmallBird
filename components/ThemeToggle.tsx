"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Mode = "light" | "dark" | "system";

const ORDER: Mode[] = ["light", "dark", "system"];
const ICON = { light: Sun, dark: Moon, system: Monitor };
const LABEL = { light: "Light", dark: "Dark", system: "System" };

function readMode(): Mode {
  try {
    const stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // Storage blocked -- fall through to system.
  }
  return "system";
}

function apply(mode: Mode) {
  const dark = mode === "dark" || (mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

// Cycles Light -> Dark -> System. "System" clears the stored preference so the
// console tracks the OS setting, including live changes.
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");

  useEffect(() => {
    setMode(readMode());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "theme") return;
      const next = readMode();
      setMode(next);
      apply(next);
    };
    // Keeps the top-bar and sidebar toggles in sync within this tab.
    const onLocal = (e: Event) => setMode((e as CustomEvent<Mode>).detail);
    window.addEventListener("storage", onStorage);
    window.addEventListener("themechange", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("themechange", onLocal);
    };
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  function cycle() {
    const next = ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length];
    setMode(next);
    apply(next);
    window.dispatchEvent(new CustomEvent<Mode>("themechange", { detail: next }));
    try {
      if (next === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", next);
    } catch {
      // Private browsing / storage blocked -- theme just won't persist.
    }
  }

  const Icon = ICON[mode];
  const nextLabel = LABEL[ORDER[(ORDER.indexOf(mode) + 1) % ORDER.length]];

  return (
    <button
      onClick={cycle}
      aria-label={`Theme: ${LABEL[mode]}. Switch to ${nextLabel}`}
      title={`Theme: ${LABEL[mode]}`}
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-ink lg:h-8 lg:w-8"
    >
      <Icon size={16} />
    </button>
  );
}
