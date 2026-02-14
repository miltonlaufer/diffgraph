import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { type DiffMeta, fetchDiffMeta, getDiffId } from "./api";
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
  const toggleChangesOnly = useCallback(() => {
    runInteractiveUpdate(() => setChangesOnly((current) => !current));
  }, [runInteractiveUpdate]);
  const canShowReact = meta?.hasReactView ?? true;
  const isInteractionPending = interactionBusy || isTransitionPending;

  /******************* USEEFFECTS ***********************/
  useEffect(() => {
    if (!diffId) return;
    fetchDiffMeta(diffId).then(setMeta).catch(() => {});
  }, [diffId]);

  useEffect(() => {
    if (!canShowReact && tab === "react") {
      setTab("logic");
    }
  }, [canShowReact, tab]);

  useEffect(() => () => {
    cancelPendingFrames();
  }, [cancelPendingFrames]);

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
          <button type="button" onClick={showLogic} className={tab === "logic" ? "active" : ""}>
            Logic
          </button>
          <button type="button" onClick={showKnowledge} className={tab === "knowledge" ? "active" : ""}>
            Knowledge
          </button>
          {canShowReact && (
            <button type="button" onClick={showReact} className={tab === "react" ? "active" : ""}>
              React
            </button>
          )}
        </div>
      </header>

      {tab === "logic" && <LogicDiffView diffId={diffId} showChangesOnly={changesOnly} />}
      {tab === "knowledge" && <KnowledgeDiffView diffId={diffId} showChangesOnly={changesOnly} />}
      {tab === "react" && canShowReact && <ReactDiffView diffId={diffId} showChangesOnly={changesOnly} />}

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
