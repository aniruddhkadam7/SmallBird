import { useEffect, useRef, useState } from "react";
import { COMPANIES, type CompanyEntry } from "./companies";
import { logoUrlForDomain } from "./logoProvider";

const MAX_SUGGESTIONS = 6;

function findExactMatch(name: string): CompanyEntry | undefined {
  const lowered = name.trim().toLowerCase();
  if (!lowered) return undefined;
  return COMPANIES.find((c) => c.name.toLowerCase() === lowered);
}

/// Ranks name-start and word-start matches ("ey" -> "EY", "e" in "Electronic
/// Arts") above a match buried mid-word ("ey" also occurs inside "Morgan
/// StanlEY" and "McKinsEY") — a plain `.includes()` search surfaced those
/// noisy mid-word hits ahead of, or alongside, the obviously-intended ones.
function matchSuggestions(query: string): CompanyEntry[] {
  const lowered = query.trim().toLowerCase();
  if (!lowered) return [];

  const starts: CompanyEntry[] = [];
  const wordStarts: CompanyEntry[] = [];
  const contains: CompanyEntry[] = [];

  for (const entry of COMPANIES) {
    const name = entry.name.toLowerCase();
    if (name.startsWith(lowered)) {
      starts.push(entry);
    } else if (name.split(/[\s&().-]+/).some((word) => word.startsWith(lowered))) {
      wordStarts.push(entry);
    } else if (name.includes(lowered)) {
      contains.push(entry);
    }
  }

  return [...starts, ...wordStarts, ...contains].slice(0, MAX_SUGGESTIONS);
}

/// Small circular logo preview, falling back to the company's initial when no
/// domain is known (free-typed name not in COMPANIES) or the image fails to
/// load (network hiccup, no logo for that domain).
function CompanyAvatar({ name, domain }: { name: string; domain: string | null }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [domain]);

  if (domain && !failed) {
    return (
      <img
        src={logoUrlForDomain(domain, 32)}
        alt=""
        className="company-avatar company-avatar-img"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="company-avatar company-avatar-fallback" aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

interface Props {
  value: string;
  onChange: (name: string) => void;
  id?: string;
  placeholder?: string;
}

/// Company name field for the "Start Interview" details prompt — free text
/// with autocomplete suggestions (each showing its logo) drawn from the
/// bundled COMPANIES list. Picking a suggestion or typing an exact match
/// resolves a logo preview next to the input, the way Parakeet's own
/// pre-interview company picker does; anything else stays plain text with no
/// logo, since there's no live name->domain lookup wired up here.
export function CompanySelect({ value, onChange, id, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const resolved = findExactMatch(value);
  const query = value.trim().toLowerCase();
  const suggestions = matchSuggestions(query);
  const showMenu = open && suggestions.length > 0 && !(suggestions.length === 1 && resolved?.name === suggestions[0].name);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown, true);
    return () => document.removeEventListener("mousedown", handlePointerDown, true);
  }, [open]);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  const commit = (entry: CompanyEntry) => {
    onChange(entry.name);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showMenu) return;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlighted((i) => Math.min(suggestions.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlighted((i) => Math.max(0, i - 1));
        break;
      case "Enter":
        if (suggestions[highlighted]) {
          e.preventDefault();
          commit(suggestions[highlighted]);
        }
        break;
      case "Escape":
        setOpen(false);
        break;
    }
  };

  return (
    <div className="company-select" ref={rootRef}>
      <div className="company-select-input-row">
        <CompanyAvatar name={value} domain={resolved?.domain ?? null} />
        <input
          id={id}
          className="setup-input"
          type="text"
          value={value}
          placeholder={placeholder ?? "e.g. Google"}
          autoComplete="off"
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {showMenu && (
        <div className="company-select-menu" role="listbox">
          {suggestions.map((entry, i) => (
            <button
              key={entry.domain}
              type="button"
              role="option"
              aria-selected={i === highlighted}
              className={`dropdown-item company-select-option${i === highlighted ? " highlighted" : ""}`}
              onMouseEnter={() => setHighlighted(i)}
              onClick={() => commit(entry)}
            >
              <CompanyAvatar name={entry.name} domain={entry.domain} />
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
