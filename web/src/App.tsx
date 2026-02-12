import { useCallback, useMemo, useState } from "react";
import { getDiffId } from "./api";
import LogicDiffView from "./views/LogicDiffView";
import KnowledgeDiffView from "./views/KnowledgeDiffView";
import ReactDiffView from "./views/ReactDiffView";
import "./App.css";

type Tab = "logic" | "knowledge" | "react";

const App = () => {
  /******************* STORE ***********************/
  const [tab, setTab] = useState<Tab>("logic");
  const [changesOnly, setChangesOnly] = useState<boolean>(true);

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

  /******************* USEEFFECTS ***********************/

  if (!diffId) {
    return (
      <main className="appContainer">
        <h1>DiffGraph</h1>
        <p>Add a <code>diffId</code> query parameter in the URL.</p>
      </main>
    );
  }

  return (
    <main className="appContainer">
      <header className="appHeader">
        <h1>DiffGraph</h1>
        <div className="tabBar">
          <button type="button" onClick={toggleChangesOnly} className={changesOnly ? "active" : ""}>
            Changes Only
          </button>
          <button type="button" onClick={showLogic} className={tab === "logic" ? "active" : ""}>
            Logic
          </button>
          <button type="button" onClick={showKnowledge} className={tab === "knowledge" ? "active" : ""}>
            Knowledge
          </button>
          <button type="button" onClick={showReact} className={tab === "react" ? "active" : ""}>
            React
          </button>
        </div>
      </header>

      {tab === "logic" && <LogicDiffView diffId={diffId} showChangesOnly={changesOnly} />}
      {tab === "knowledge" && <KnowledgeDiffView diffId={diffId} showChangesOnly={changesOnly} />}
      {tab === "react" && <ReactDiffView diffId={diffId} showChangesOnly={changesOnly} />}
    </main>
  );
};

export default App;
