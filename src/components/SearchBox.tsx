import type { RefObject } from "react";
import { t } from "@/lib/i18n";
import { CloseIcon, SearchIcon } from "@/components/icons";

interface Props {
  value: string;
  onChange: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function SearchBox({ value, onChange, inputRef }: Props) {
  return (
    <div className="search">
      <SearchIcon size={14} />
      <input
        ref={inputRef}
        type="search"
        value={value}
        aria-label={t("searchPlaceholder")}
        placeholder={t("searchPlaceholder")}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onChange("");
          }
        }}
      />
      {value && (
        <button type="button" className="search-clear" title={t("searchClear")} aria-label={t("searchClear")} onClick={() => onChange("")}>
          <CloseIcon size={13} />
        </button>
      )}
    </div>
  );
}
