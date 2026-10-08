import { useState, type Dispatch, type SetStateAction } from "react";
import { DocumentContext, type DocumentContextState } from "./DocumentContext";
import { customContextSections, MAX_CUSTOM_MODE_NAME, type CustomMode, type CustomModeListenTo } from "./customModes";
import { Button } from "./ui";

const LISTEN_OPTIONS: { value: CustomModeListenTo; label: string; description: string }[] = [
  { value: "call", label: "Call audio", description: "Hears the other people — calls, meetings, videos" },
  { value: "mic", label: "My mic", description: "Hears you — talk to it like an assistant" },
];

interface Props {
  /// The mode being edited — a fresh, not-yet-saved one when `isNew`.
  mode: CustomMode;
  isNew: boolean;
  /// This mode's own Context (instructions + documents), edited live.
  contextState: DocumentContextState;
  onContextChange: Dispatch<SetStateAction<DocumentContextState>>;
  isLive: boolean;
  onSave: (mode: CustomMode) => void;
  onCancel: () => void;
  onDelete: () => void;
}

/// Create / edit a custom mode: its name, how the AI should act, what it
/// listens to, and its own instructions and documents (the same Context
/// sections the header's Context button shows while the mode is selected).
export function CustomModeEditor({ mode, isNew, contextState, onContextChange, isLive, onSave, onCancel, onDelete }: Props) {
  const [name, setName] = useState(mode.name);
  const [role, setRole] = useState(mode.role);
  const [listenTo, setListenTo] = useState<CustomModeListenTo>(mode.listenTo);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const trimmedName = name.trim();

  const save = () => {
    if (!trimmedName) return;
    onSave({ ...mode, name: trimmedName, role: role.trim(), listenTo });
  };

  return (
    <div className="popover" role="dialog" aria-label={isNew ? "New custom mode" : `Edit ${mode.name}`}>
      <div className="popover-header">
        <span className="setup-section-label">{isNew ? "New custom mode" : `Edit mode — ${mode.name}`}</span>
        <button className="modal-close-btn" onClick={onCancel} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="popover-body custom-mode-editor">
        <div className="custom-mode-fields">
          <div className="setup-identity-field">
            <label className="setup-section-label" htmlFor="custom-mode-name">
              Mode name
            </label>
            <input
              id="custom-mode-name"
              className="setup-input"
              type="text"
              value={name}
              maxLength={MAX_CUSTOM_MODE_NAME}
              placeholder="e.g. Sales calls, Customer support, Study buddy"
              autoFocus={isNew}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
            />
          </div>
          <div className="setup-identity-field">
            <label className="setup-section-label">Listens to</label>
            <div className="custom-mode-listen" role="radiogroup" aria-label="Listens to">
              {LISTEN_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={listenTo === o.value}
                  className={`custom-mode-listen-option${listenTo === o.value ? " active" : ""}`}
                  title={o.description}
                  onClick={() => setListenTo(o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="setup-identity-field">
          <label className="setup-section-label" htmlFor="custom-mode-role">
            How should the AI act? <span className="setup-section-optional">Optional</span>
          </label>
          <textarea
            id="custom-mode-role"
            className="setup-textarea custom-mode-role"
            value={role}
            placeholder={
              "Who the AI is and how it behaves in this mode — e.g. You are me, a sales rep at Acme selling CRM software. " +
              "Suggest what I should say next on the call: confident, friendly, first person, handle objections with our pricing and case studies."
            }
            onChange={(e) => setRole(e.target.value)}
          />
        </div>
        <DocumentContext
          sections={customContextSections(mode.id)}
          state={contextState}
          onChange={onContextChange}
          isLive={isLive}
        />
      </div>
      <div className="popover-footer">
        {!isNew &&
          (confirmingDelete ? (
            <>
              <span className="custom-mode-delete-confirm">Delete this mode?</span>
              <Button variant="danger" size="sm" onClick={onDelete}>
                Delete
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirmingDelete(true)} disabled={isLive}>
              Delete mode
            </Button>
          ))}
        <span className="custom-mode-footer-spacer" />
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={save}
          disabled={!trimmedName}
          title={trimmedName ? undefined : "Give the mode a name first"}
        >
          {isNew ? "Create mode" : "Save"}
        </Button>
      </div>
    </div>
  );
}
