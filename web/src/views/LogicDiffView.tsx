import { ViewBase } from "./ViewBase";

interface LogicDiffViewProps {
  diffId: string;
  showChangesOnly: boolean;
}

const LogicDiffView = ({ diffId, showChangesOnly }: LogicDiffViewProps) => (
  <ViewBase diffId={diffId} viewType="logic" showChangesOnly={showChangesOnly} />
);

export default LogicDiffView;
