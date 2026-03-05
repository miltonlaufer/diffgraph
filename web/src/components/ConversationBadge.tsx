import type { ReactElement } from "react";

interface ConversationBadgeProps {
  count: number;
  unresolvedCount?: number;
  className?: string;
  onClick: () => void;
}

export const ConversationBadge = ({
  count,
  unresolvedCount = 0,
  className,
  onClick,
}: ConversationBadgeProps): ReactElement | null => {
  if (count <= 0) return null;

  const unresolvedLabel = unresolvedCount > 0
    ? `${unresolvedCount} unresolved`
    : "all resolved";
  const title = `${count} conversation${count === 1 ? "" : "s"} (${unresolvedLabel})`;
  const classes = className ? `conversationBadge ${className}` : "conversationBadge";

  return (
    <button
      type="button"
      className={classes}
      title={title}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
    >
      <span aria-hidden className="conversationBadgeIcon">💬</span>
      <span className="conversationBadgeCount">{count}</span>
      {unresolvedCount > 0 && <span className="conversationBadgeUnresolvedDot" aria-hidden />}
    </button>
  );
};

export default ConversationBadge;
