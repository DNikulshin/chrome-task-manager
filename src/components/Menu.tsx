import { useEffect, useRef, useState } from "react";
import { t } from "@/lib/i18n";
import { DownloadIcon, MoreIcon, TrashIcon, UploadIcon } from "@/components/icons";

interface Props {
  onExport: () => void;
  onImport: (file: File) => void;
  onClearCompleted: () => void;
  canClearCompleted: boolean;
}

/**
 * Меню «Ещё». Слушатель клика по документу ставится только пока меню открыто
 * и снимается при закрытии — иначе на каждый рендер остаётся по слушателю.
 */
export function Menu({ onExport, onImport, onClearCompleted, canClearCompleted }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="menu" ref={wrapRef}>
      <button
        ref={triggerRef}
        type="button"
        className="icon-btn"
        title={t("headerMenu")}
        aria-label={t("headerMenu")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreIcon size={15} />
      </button>

      {open && (
        <div className="menu-popup" role="menu">
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close();
              onExport();
            }}
          >
            <DownloadIcon size={15} />
            {t("menuExport")}
          </button>
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            onClick={() => {
              close();
              fileRef.current?.click();
            }}
          >
            <UploadIcon size={15} />
            {t("menuImport")}
          </button>
          <div className="menu-sep" />
          <button
            type="button"
            role="menuitem"
            className="menu-item"
            disabled={!canClearCompleted}
            onClick={() => {
              close();
              onClearCompleted();
            }}
          >
            <TrashIcon size={15} />
            {t("menuClearCompleted")}
          </button>
          <div className="menu-note">{t("menuHint")}</div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onImport(file);
        }}
      />
    </div>
  );
}
