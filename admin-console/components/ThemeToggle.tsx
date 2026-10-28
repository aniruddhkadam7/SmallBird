"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function apply(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

// A plain sun / moon switch. Until it's tapped the console follows the
// phone's / computer's own setting (layout.tsx's init script); a tap
// switches between light and dark and remembers the choice.
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(currentTheme());
    // Keeps the top-bar and sidebar toggles, and other tabs, in sync.
    const sync = () => setTheme(currentTheme());
    const onStorage = (e: StorageEvent) => {
      if (e.key !== "theme" || (e.newValue !== "light" && e.newValue !== "dark")) return;
      apply(e.newValue);
      sync();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("themechange", sync);
    // Following the OS: its changes flip the theme (handled in layout.tsx).
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onOs = () => setTimeout(sync, 0);
    mq.addEventListener("change", onOs);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("themechange", sync);
      mq.removeEventListener("change", onOs);
    };
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    apply(next);
    setTheme(next);
    window.dispatchEvent(new Event("themechange"));
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Private browsing / storage blocked -- theme just won't persist.
    }
  }

  const Icon = theme === "dark" ? Sun : Moon;

  return (
    <button
      onClick={toggle}
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-ink lg:h-8 lg:w-8"
    >
      <Icon size={18} strokeWidth={1.8} />
    </button>
  );
}
