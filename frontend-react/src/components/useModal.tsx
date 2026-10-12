import { useCallback, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { PromptDialog } from "./PromptDialog";
import { AlertDialog } from "./AlertDialog";
import { ChooseDialog } from "./ChooseDialog";

// Gives a ported page's decision logic the same promise-based ergonomics
// frontend/js/modal.js's modalPrompt()/modalConfirm()/modalAlert()/
// modalChoose() had (`const reason = await promptAsync(...); if (!reason)
// return; ...`), backed by React state instead of a singleton DOM overlay.
// Lets dense branching logic like Vendor View's decide() (and Catalog's
// Category Form) stay close to a straight 1:1 port instead of being
// restructured into an explicit dialog-state machine.
type Pending =
  | { kind: "prompt"; message: string; placeholder: string; resolve: (v: string | null) => void }
  | { kind: "confirm"; message: string; title: string; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }
  | { kind: "alert"; message: string; title: string; resolve: () => void }
  | { kind: "choose"; message: string; title: string; options: { value: string; label: string }[]; resolve: (v: string | null) => void };

export function useModal() {
  const [pending, setPending] = useState<Pending | null>(null);

  const promptAsync = useCallback((message: string, placeholder = ""): Promise<string | null> => {
    return new Promise((resolve) => setPending({ kind: "prompt", message, placeholder, resolve }));
  }, []);

  const confirmAsync = useCallback((message: string, opts: { title?: string; confirmLabel?: string; danger?: boolean } = {}): Promise<boolean> => {
    return new Promise((resolve) =>
      setPending({ kind: "confirm", message, title: opts.title ?? "Please Confirm", confirmLabel: opts.confirmLabel ?? "Confirm", danger: !!opts.danger, resolve })
    );
  }, []);

  const alertAsync = useCallback((message: string, title = "Notice"): Promise<void> => {
    return new Promise((resolve) => setPending({ kind: "alert", message, title, resolve }));
  }, []);

  const chooseAsync = useCallback((message: string, options: { value: string; label: string }[], title = "Choose One"): Promise<string | null> => {
    return new Promise((resolve) => setPending({ kind: "choose", message, title, options, resolve }));
  }, []);

  let modalElement = null;
  if (pending?.kind === "prompt") {
    const p = pending;
    modalElement = (
      <PromptDialog
        message={p.message}
        placeholder={p.placeholder}
        onSubmit={(v) => {
          setPending(null);
          p.resolve(v);
        }}
        onCancel={() => {
          setPending(null);
          p.resolve(null);
        }}
      />
    );
  } else if (pending?.kind === "confirm") {
    const p = pending;
    modalElement = (
      <ConfirmDialog
        title={p.title}
        message={p.message}
        confirmLabel={p.confirmLabel}
        danger={p.danger}
        onConfirm={() => {
          setPending(null);
          p.resolve(true);
        }}
        onCancel={() => {
          setPending(null);
          p.resolve(false);
        }}
      />
    );
  } else if (pending?.kind === "alert") {
    const p = pending;
    modalElement = (
      <AlertDialog
        title={p.title}
        message={p.message}
        onClose={() => {
          setPending(null);
          p.resolve();
        }}
      />
    );
  } else if (pending?.kind === "choose") {
    const p = pending;
    modalElement = (
      <ChooseDialog
        title={p.title}
        message={p.message}
        options={p.options}
        onSubmit={(v) => {
          setPending(null);
          p.resolve(v);
        }}
        onCancel={() => {
          setPending(null);
          p.resolve(null);
        }}
      />
    );
  }

  return { promptAsync, confirmAsync, alertAsync, chooseAsync, modalElement };
}
