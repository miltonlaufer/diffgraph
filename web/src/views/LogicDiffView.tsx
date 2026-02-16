import { ViewBase } from "./ViewBase";

interface LogicDiffViewProps {
  diffId: string;
  showChangesOnly: boolean;
  pullRequestDescriptionExcerpt?: string;
}

const LogicDiffView = ({ diffId, showChangesOnly, pullRequestDescriptionExcerpt }: LogicDiffViewProps) => (
  <ViewBase
    diffId={diffId}
    viewType="logic"
    showChangesOnly={showChangesOnly}
    pullRequestDescriptionExcerpt={pullRequestDescriptionExcerpt}
  />
);

export default LogicDiffView;
