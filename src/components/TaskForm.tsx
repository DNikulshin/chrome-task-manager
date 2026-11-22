import { useEffect, useState } from "react";
import type { FormEvent, KeyboardEvent, RefObject } from "react";
import type { Task } from "@/types";
import { MAX_TEXT } from "@/lib/tasks";
import { t } from "@/lib/i18n";
import { CheckIcon, PlusIcon } from "@/components/icons";

interface Props {
  editing: Task | null;
  inputRef: RefObject<HTMLInputElement | null>;
  onSubmit: (text: string) => boolean;
  onUpdate: (id: string, text: string) => void;
  onCancel: () => void;
}

export function TaskForm({ editing, inputRef, onSubmit, onUpdate, onCancel }: Props) {
  const isEditing = editing !== null;
  const [text, setText] = useState("");
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    setText(editing?.text ?? "");
    if (editing) {
      const input = inputRef.current;
      input?.focus();
      input?.setSelectionRange(editing.text.length, editing.text.length);
    }
  }, [editing, inputRef]);

  const submit = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const value = text.trim();
    if (!value) {
      setFlash(true);
      window.setTimeout(() => setFlash(false), 400);
      inputRef.current?.focus();
      return;
    }
    if (isEditing && editing) onUpdate(editing.id, value);
    else if (!onSubmit(value)) return;
    setText("");
    inputRef.current?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (isEditing) onCancel();
    else setText("");
  };

  const warn = text.length > MAX_TEXT * 0.85;

  return (
    <form className="form" onSubmit={submit} data-flash={flash || undefined}>
      <div className="field">
        <input
          ref={inputRef}
          type="text"
          name="task"
          value={text}
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_TEXT}
          aria-label={isEditing ? t("formPlaceholderEdit") : t("formPlaceholder")}
          placeholder={isEditing ? t("formPlaceholderEdit") : t("formPlaceholder")}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {text.length > 0 && (
          <span className="counter" data-warn={warn} aria-hidden="true">
            {text.length}/{MAX_TEXT}
          </span>
        )}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary">
          {isEditing ? <CheckIcon size={14} /> : <PlusIcon size={14} />}
          {isEditing ? t("formSave") : t("formAdd")}
        </button>
        {isEditing && (
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            {t("formCancel")}
          </button>
        )}
      </div>
    </form>
  );
}
