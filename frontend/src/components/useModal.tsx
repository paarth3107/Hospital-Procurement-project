import { useCallback, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { PromptDialog } from "./PromptDialog";
import { ReasonDialog } from "./ReasonDialog";
import { AlertDialog } from "./AlertDialog";
import { ChooseDialog } from "./ChooseDialog";
import { DocumentPreviewModal, type PreviewFile } from "./DocumentPreviewModal";

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
  | {
      kind: "reason";
      title: string;
      message?: string;
      placeholder: string;
      confirmLabel: string;
      danger: boolean;
      maxLength: number;
      minLength: number;
      resolve: (v: string | null) => void;
    }
  | { kind: "alert"; message: string; title: string; resolve: () => void }
  | { kind: "choose"; message: string; title: string; options: { value: string; label: string }[]; resolve: (v: string | null) => void }
  | { kind: "preview"; file: PreviewFile; onClosed?: () => void };

export function useModal() {
  const [pending, setPending] = useState<Pending | null>(null);

  const promptAsync = useCallback((message: string, placeholder = ""): Promise<string | null> => {
    return new Promise((resolve) => setPending({ kind: "prompt", message, placeholder, resolve }));
  }, []);

  // The standard "reason for X" dialog (components/ReasonDialog.tsx) --
  // reason entry and confirmation in one popup, one title naming the
  // action, a confirm button labeled the same way. Replaces every
  // promptAsync-then-confirmAsync pair a decide()-style action used to
  // chain for a reason field specifically; promptAsync itself stays for
  // genuinely short, non-reason text (a sub-category name, a document
  // label) where this dialog's length rule and multi-line box don't fit.
  const reasonAsync = useCallback(
    (opts: { title: string; message?: string; placeholder?: string; confirmLabel?: string; danger?: boolean; maxLength?: number; minLength?: number }): Promise<string | null> => {
      return new Promise((resolve) =>
        setPending({
          kind: "reason",
          title: opts.title,
          message: opts.message,
          placeholder: opts.placeholder ?? "",
          confirmLabel: opts.confirmLabel ?? "Confirm",
          danger: !!opts.danger,
          maxLength: opts.maxLength ?? 500,
          minLength: opts.minLength ?? 10,
          resolve,
        })
      );
    },
    []
  );

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

  // Not promise-based like the others -- nothing awaits "the user closed
  // the preview," so onClosed is a plain fire-and-forget callback (the
  // call site uses it to revoke the blob URL it created).
  const openPreview = useCallback((file: PreviewFile, onClosed?: () => void) => {
    setPending({ kind: "preview", file, onClosed });
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
  } else if (pending?.kind === "reason") {
    const p = pending;
    modalElement = (
      <ReasonDialog
        title={p.title}
        message={p.message}
        placeholder={p.placeholder}
        confirmLabel={p.confirmLabel}
        danger={p.danger}
        maxLength={p.maxLength}
        minLength={p.minLength}
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
  } else if (pending?.kind === "preview") {
    const p = pending;
    modalElement = (
      <DocumentPreviewModal
        file={p.file}
        onClose={() => {
          setPending(null);
          p.onClosed?.();
        }}
      />
    );
  }

  return { promptAsync, confirmAsync, reasonAsync, alertAsync, chooseAsync, openPreview, modalElement };
}
