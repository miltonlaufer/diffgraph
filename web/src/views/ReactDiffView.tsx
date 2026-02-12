import { ViewBase } from "./ViewBase";

interface ReactDiffViewProps {
  diffId: string;
  showChangesOnly: boolean;
}

const ReactDiffView = ({ diffId, showChangesOnly }: ReactDiffViewProps) => (
  <ViewBase diffId={diffId} viewType="react" showChangesOnly={showChangesOnly} />
);

export default ReactDiffView;
