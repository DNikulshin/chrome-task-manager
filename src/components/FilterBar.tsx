import type { Filter } from "@/types";
import { t } from "@/lib/i18n";

interface Props {
  filter: Filter;
  counts: Record<Filter, number>;
  onChange: (filter: Filter) => void;
  onClearCompleted: () => void;
}

const OPTIONS: Array<{ value: Filter; label: () => string }> = [
  { value: "all", label: () => t("filterAll") },
  { value: "active", label: () => t("filterActive") },
  { value: "completed", label: () => t("filterCompleted") },
];

export function FilterBar({ filter, counts, onChange, onClearCompleted }: Props) {
  return (
    <div className="filter-row">
      <div className="segmented" role="group" aria-label={t("listLabel")}>
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className="chip"
            aria-pressed={filter === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label()}
            <span className="chip-count">{counts[option.value]}</span>
          </button>
        ))}
      </div>
      {counts.completed > 0 && (
        <button type="button" className="clear-done" onClick={onClearCompleted}>
          {t("filterClearShort")} ({counts.completed})
        </button>
      )}
    </div>
  );
}
