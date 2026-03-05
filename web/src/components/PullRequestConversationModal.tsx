import { useEffect, useMemo, type ReactElement } from "react";
import type { PullRequestReviewThread } from "#/api";
import { MarkdownViewer } from "./MarkdownViewer";

interface PullRequestConversationModalProps {
  open: boolean;
  pullRequestNumber?: string;
  threads: PullRequestReviewThread[];
  onClose: () => void;
}

const formatDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
};

const formatRange = (start?: number, end?: number): string => {
  if (!end || end < 1) return "";
  const safeStart = start && start > 0 ? start : end;
  if (safeStart === end) return String(end);
  if (safeStart < end) return `${safeStart}-${end}`;
  return `${end}-${safeStart}`;
};

const threadLocationLabel = (thread: PullRequestReviewThread): string => {
  if (thread.kind === "discussion") return "";
  const newRange = formatRange(thread.startLine, thread.line);
  const oldRange = formatRange(thread.originalStartLine, thread.originalLine);
  const segments: string[] = [];
  if (newRange) segments.push(`new:${newRange}`);
  if (oldRange) segments.push(`old:${oldRange}`);
  return segments.join(" | ");
};

export const PullRequestConversationModal = ({
  open,
  pullRequestNumber,
  threads,
  onClose,
}: PullRequestConversationModalProps): ReactElement | null => {
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      onClose();
    };
    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
    };
  }, [onClose, open]);

  const sortedThreads = useMemo(() => (
    [...threads].sort((a, b) => {
      const aTime = Date.parse(a.comments[a.comments.length - 1]?.updatedAt ?? a.comments[a.comments.length - 1]?.createdAt ?? "");
      const bTime = Date.parse(b.comments[b.comments.length - 1]?.updatedAt ?? b.comments[b.comments.length - 1]?.createdAt ?? "");
      if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
        return bTime - aTime;
      }
      return a.filePath.localeCompare(b.filePath);
    })
  ), [threads]);

  if (!open || typeof document === "undefined") return null;

  return (
    <div className="prConversationModalBackdrop" role="presentation" onClick={onClose}>
      <section
        className="prConversationModal"
        role="dialog"
        aria-modal="true"
        aria-label="Pull request review conversations"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="prConversationModalHeader">
          <h3 className="prConversationModalTitle">
            Conversations
            {pullRequestNumber ? ` #${pullRequestNumber}` : ""}
          </h3>
          <button type="button" className="prConversationCloseBtn" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="prConversationModalBody">
          {sortedThreads.length === 0 ? (
            <p className="dimText">No conversations available.</p>
          ) : (
            sortedThreads.map((thread) => {
              const location = threadLocationLabel(thread);
              const isDiscussion = thread.kind === "discussion";
              return (
                <article key={thread.id} className="prConversationThread">
                  <div className="prConversationThreadHeader">
                    <div>
                      {thread.url ? (
                        <a
                          className="prConversationThreadLink"
                          href={thread.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Open thread on GitHub"
                        >
                          <div className="prConversationThreadFile">
                            {isDiscussion ? "General Discussion" : thread.filePath}
                          </div>
                          {location && <div className="prConversationThreadLocation">{location}</div>}
                        </a>
                      ) : (
                        <>
                          <div className="prConversationThreadFile">
                            {isDiscussion ? "General Discussion" : thread.filePath}
                          </div>
                          {location && <div className="prConversationThreadLocation">{location}</div>}
                        </>
                      )}
                    </div>
                    <span
                      className={isDiscussion
                        ? "prThreadStatus prThreadStatusDiscussion"
                        : thread.resolved
                          ? "prThreadStatus prThreadStatusResolved"
                          : "prThreadStatus prThreadStatusOpen"}
                    >
                      {isDiscussion ? "Discussion" : thread.resolved ? "Resolved" : "Open"}
                    </span>
                  </div>
                  <div className="prConversationMessages">
                    {thread.comments.map((comment) => (
                      <div key={comment.id} className="prConversationMessage">
                        {comment.author.avatarUrl ? (
                          <img
                            className="prConversationAvatar"
                            src={comment.author.avatarUrl}
                            alt={`${comment.author.login} avatar`}
                            loading="lazy"
                          />
                        ) : (
                          <div className="prConversationAvatarFallback">
                            {comment.author.login.slice(0, 1).toUpperCase() || "?"}
                          </div>
                        )}
                        <div className="prConversationMessageBody">
                          <div className="prConversationMessageMeta">
                            <span className="prConversationAuthor">{comment.author.login}</span>
                            {comment.url ? (
                              <a
                                className="prConversationTimestamp prConversationTimestampLink"
                                href={comment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open comment on GitHub"
                              >
                                {formatDateTime(comment.createdAt)}
                              </a>
                            ) : (
                              <span className="prConversationTimestamp">{formatDateTime(comment.createdAt)}</span>
                            )}
                          </div>
                          <div className="prConversationText">
                            <MarkdownViewer markdown={comment.body || "(no text)"} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
};

export default PullRequestConversationModal;
