import { ViewBase } from "./ViewBase";

interface ReactDiffViewProps {
  diffId: string;
  showChangesOnly: boolean;
  pullRequestDescriptionExcerpt?: string;
}

const ReactDiffView = ({ diffId, showChangesOnly, pullRequestDescriptionExcerpt }: ReactDiffViewProps) => (
  <ViewBase
    diffId={diffId}
    viewType="react"
    showChangesOnly={showChangesOnly}
    pullRequestDescriptionExcerpt={pullRequestDescriptionExcerpt}
  />
);

export default ReactDiffView;
