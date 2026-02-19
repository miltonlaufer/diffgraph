import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { type DiffMeta, fetchDiffMeta, getDiffId } from "./api";
import { MarkdownViewer } from "./components/MarkdownViewer";
import LogicDiffView from "./views/LogicDiffView";
import KnowledgeDiffView from "./views/KnowledgeDiffView";
import ReactDiffView from "./views/ReactDiffView";
import "./App.css";

type Tab = "logic" | "knowledge" | "react";

const App = () => {
  /******************* STORE ***********************/
  const [tab, setTab] = useState<Tab>("logic");
  const [changesOnly, setChangesOnly] = useState<boolean>(true);
  const [meta, setMeta] = useState<DiffMeta | null>(null);
  const [prDescriptionOpen, setPrDescriptionOpen] = useState(false);
  const [interactionBusy, setInteractionBusy] = useState(false);
  const [isTransitionPending, startTransition] = useTransition();
  const startRafRef = useRef<number | null>(null);
  const endRafRef = useRef<number | null>(null);

  /******************* COMPUTED ***********************/
  const diffId = useMemo(() => getDiffId(), []);

  /******************* FUNCTIONS ***********************/
  const cancelPendingFrames = useCallback(() => {
    if (startRafRef.current !== null) {
      window.cancelAnimationFrame(startRafRef.current);
      startRafRef.current = null;
    }
    if (endRafRef.current !== null) {
      window.cancelAnimationFrame(endRafRef.current);
      endRafRef.current = null;
    }
  }, []);

  const runInteractiveUpdate = useCallback((update: () => void) => {
    setInteractionBusy(true);
    cancelPendingFrames();
    startRafRef.current = window.requestAnimationFrame(() => {
      startRafRef.current = null;
      startTransition(() => {
        update();
      });
      endRafRef.current = window.requestAnimationFrame(() => {
        endRafRef.current = null;
        setInteractionBusy(false);
      });
    });
  }, [cancelPendingFrames, startTransition]);

  const showLogic = useCallback(() => {
    runInteractiveUpdate(() => setTab("logic"));
  }, [runInteractiveUpdate]);

  const showKnowledge = useCallback(() => {
    runInteractiveUpdate(() => setTab("knowledge"));
  }, [runInteractiveUpdate]);

  const showReact = useCallback(() => {
    runInteractiveUpdate(() => setTab("react"));
  }, [runInteractiveUpdate]);
  const openPrDescription = useCallback(() => {
    setPrDescriptionOpen(true);
  }, []);
  const openPrInGitHub = useCallback(() => {
    const url = meta?.pullRequestUrl;
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [meta?.pullRequestUrl]);
  const closePrDescription = useCallback(() => {
    setPrDescriptionOpen(false);
  }, []);
  const toggleChangesOnly = useCallback(() => {
    runInteractiveUpdate(() => setChangesOnly((current) => !current));
  }, [runInteractiveUpdate]);
  const canShowReact = meta?.hasReactView ?? true;
  const isPullRequestMode = Boolean(meta?.pullRequestNumber);
  const activeTab: Tab = (!canShowReact && tab === "react") ? "logic" : tab;
  const isInteractionPending = interactionBusy || isTransitionPending;

  /******************* USEEFFECTS ***********************/
  useEffect(() => {
    if (!diffId) return;
    fetchDiffMeta(diffId).then(setMeta).catch(() => {});
  }, [diffId]);

  useEffect(() => () => {
    cancelPendingFrames();
  }, [cancelPendingFrames]);
  useEffect(() => {
    if (!prDescriptionOpen) return undefined;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setPrDescriptionOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [prDescriptionOpen]);

  const diffGraph = useMemo(() => {
    return <h1><span style={{
      textDecoration: 'line-through',
      fontStyle: 'italic',
    }}>Diff</span><span style={
      {
        fontWeight: 900,
        color: 'white',
      }
    }>Graph</span></h1>;
  }, []);

  if (!diffId) {
    return (
      <main className="appContainer">
        {diffGraph}
        <p>Add a <code>diffId</code> query parameter in the URL.</p>
      </main>
    );
  }

  return (
    <main className="appContainer">
      <header className="appHeader">
        <div className="headerLeft">
         {diffGraph}
          {meta && (
            <span className="diffMetaLabel">
              <span className="refOld">{meta.oldRef}</span>
              <span className="refArrow">-&gt;</span>
              <span className="refNew">{meta.newRef}</span>
            </span>
          )}
        </div>
        <div className="headerControls">
          <label className="changesOnlyToggle" htmlFor="changes-only-toggle">
            <input
              id="changes-only-toggle"
              type="checkbox"
              checked={changesOnly}
              onChange={toggleChangesOnly}
            />
            <span>Changes Only</span>
          </label>
        </div>
        <div className="tabBar">
            {isPullRequestMode && (
              <button
                type="button"
                onClick={openPrInGitHub}
                className="prLinkBtn"
                title={meta?.pullRequestUrl ? `Open PR #${meta?.pullRequestNumber ?? ""} on GitHub` : "PR link unavailable"}
                disabled={!meta?.pullRequestUrl}
              >
                PR {"\u2197"}
              </button>
            )}
            {isPullRequestMode && (
              <button
                type="button"
                onClick={openPrDescription}
                className={prDescriptionOpen ? "active prDescriptionBtn" : "prDescriptionBtn"}
                title={`Open PR #${meta?.pullRequestNumber ?? ""} description`}
              >
                PR Description
              </button>
            )}
	          <button type="button" onClick={showLogic} className={activeTab === "logic" ? "active" : ""}>
	            Logic
	          </button>
	          <button type="button" onClick={showKnowledge} className={activeTab === "knowledge" ? "active" : ""}>
	            Knowledge
	          </button>
	          {canShowReact && (
	            <button type="button" onClick={showReact} className={activeTab === "react" ? "active" : ""}>
	              React
	              <span className="tabBadge">Beta</span>
	            </button>
	          )}
        </div>
      </header>

	      {activeTab === "logic" && (
          <LogicDiffView
            diffId={diffId}
            showChangesOnly={changesOnly}
            pullRequestDescriptionExcerpt={meta?.pullRequestDescriptionExcerpt}
          />
        )}
	      {activeTab === "knowledge" && (
          <KnowledgeDiffView
            diffId={diffId}
            showChangesOnly={changesOnly}
            pullRequestDescriptionExcerpt={meta?.pullRequestDescriptionExcerpt}
          />
        )}
	      {activeTab === "react" && canShowReact && (
          <ReactDiffView
            diffId={diffId}
            showChangesOnly={changesOnly}
            pullRequestDescriptionExcerpt={meta?.pullRequestDescriptionExcerpt}
          />
        )}

      {prDescriptionOpen && (
        <div
          className="prDescriptionModalBackdrop"
          role="presentation"
          onClick={closePrDescription}
        >
          <section
            className="prDescriptionModal"
            role="dialog"
            aria-modal="true"
            aria-label="Pull Request Description"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="prDescriptionModalHeader">
              <h3 className="prDescriptionModalTitle">
                PR Description {meta?.pullRequestNumber ? `#${meta.pullRequestNumber}` : ""}
              </h3>
              <button type="button" className="prDescriptionCloseBtn" onClick={closePrDescription}>
                Close
              </button>
            </header>
            <div className="prDescriptionModalBody">
              <MarkdownViewer markdown={meta?.pullRequestDescription?.trim() || "_No PR description available._"} />
            </div>
          </section>
        </div>
      )}

      {isInteractionPending && (
        <div className="interactionOverlay interactionOverlayGlobal" role="status" aria-live="polite">
          <div className="spinner" />
          <p className="dimText">Updating view...</p>
        </div>
      )}
    </main>
  );
};

export default App;
