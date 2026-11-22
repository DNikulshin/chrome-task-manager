import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Task } from "@/types";
import { t } from "@/lib/i18n";
import { ClipboardIcon } from "@/components/icons";
import { TaskItem } from "@/components/TaskItem";

interface Props {
  tasks: Task[];
  query: string;
  canReorder: boolean;
  emptyMessage: string;
  onToggle: (id: string) => void;
  onTogglePriority: (id: string) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  onCopy: (task: Task) => void;
}

export function TaskList({ tasks, query, canReorder, emptyMessage, onToggle, onTogglePriority, onEdit, onDelete, onCopy }: Props) {
  if (!tasks.length) {
    return (
      <div className="empty">
        <ClipboardIcon size={28} />
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
      <ul className="task-list" aria-label={t("listLabel")}>
        {tasks.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            query={query}
            canReorder={canReorder}
            onToggle={onToggle}
            onTogglePriority={onTogglePriority}
            onEdit={onEdit}
            onDelete={onDelete}
            onCopy={onCopy}
          />
        ))}
      </ul>
    </SortableContext>
  );
}
