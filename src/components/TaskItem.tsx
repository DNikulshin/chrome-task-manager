import { memo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Task } from "@/types";
import { highlightParts, relativeDate } from "@/lib/tasks";
import { currentLang, t } from "@/lib/i18n";
import {
  CheckIcon,
  CopyIcon,
  GripIcon,
  PencilIcon,
  StarIcon,
  TrashIcon,
} from "@/components/icons";

interface Props {
  task: Task;
  query: string;
  canReorder: boolean;
  onToggle: (id: string) => void;
  onTogglePriority: (id: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onCopy: (task: Task) => void;
}

function TaskItemBase({ task, query, canReorder, onToggle, onTogglePriority, onEdit, onDelete, onCopy }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canReorder,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const lang = currentLang();

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="task-card"
      data-id={task.id}
      data-priority={task.priority}
      data-completed={task.completed}
      data-dragging={isDragging || undefined}
    >
      <button
        type="button"
        className="drag-handle"
        title={canReorder ? t("taskDrag") : t("hintReorderLocked")}
        aria-label={t("taskDrag")}
        disabled={!canReorder}
        {...attributes}
        {...listeners}
      >
        <GripIcon size={14} />
      </button>

      <button
        type="button"
        className="task-checkbox"
        role="checkbox"
        aria-checked={task.completed}
        aria-label={task.completed ? t("taskToggleOn") : t("taskToggleOff")}
        onClick={() => onToggle(task.id)}
      >
        <CheckIcon size={12} />
      </button>

      <div className="task-body">
        <p className="task-text">
          {highlightParts(task.text, query).map((part, index) =>
            part.match ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
          )}
        </p>
        <div className="task-meta">
          <span className="meta-date">{relativeDate(task.createdAt, lang)}</span>
          {task.priority === "high" && (
            <span className="badge-priority">
              <StarIcon size={9} filled />
              {t("taskPriorityBadge")}
            </span>
          )}
        </div>
      </div>

      <div className="task-actions">
        <button
          type="button"
          className="icon-btn"
          title={task.priority === "high" ? t("taskPriorityUnset") : t("taskPrioritySet")}
          aria-label={task.priority === "high" ? t("taskPriorityUnset") : t("taskPrioritySet")}
          aria-pressed={task.priority === "high"}
          onClick={() => onTogglePriority(task.id)}
        >
          <StarIcon size={14} filled={task.priority === "high"} />
        </button>
        <button type="button" className="icon-btn" title={t("taskCopy")} aria-label={t("taskCopy")} onClick={() => onCopy(task)}>
          <CopyIcon size={14} />
        </button>
        <button type="button" className="icon-btn" title={t("taskEdit")} aria-label={t("taskEdit")} onClick={() => onEdit(task)}>
          <PencilIcon size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          data-role="delete"
          title={t("taskDelete")}
          aria-label={t("taskDelete")}
          onClick={() => onDelete(task)}
        >
          <TrashIcon size={14} />
        </button>
      </div>
    </li>
  );
}

export const TaskItem = memo(TaskItemBase);
