import { useCallback, useEffect, useMemo, useState } from "react";
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

  /******************* COMPUTED ***********************/
  const diffId = useMemo(() => getDiffId(), []);

  /******************* FUNCTIONS ***********************/
  const showLogic = useCallback(() => {
    setTab("logic");
  }, []);

  const showKnowledge = useCallback(() => {
    setTab("knowledge");
  }, []);

  const showReact = useCallback(() => {
    setTab("react");
  }, []);
  const toggleChangesOnly = useCallback(() => {
    setChangesOnly((current) => !current);
  }, []);
  const canShowReact = meta?.hasReactView ?? true;

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
    </main>
  );
};

export default App;
