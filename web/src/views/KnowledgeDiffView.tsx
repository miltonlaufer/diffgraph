import { ViewBase } from "./ViewBase";

interface KnowledgeDiffViewProps {
  diffId: string;
  showChangesOnly: boolean;
  pullRequestDescriptionExcerpt?: string;
}

const KnowledgeDiffView = ({ diffId, showChangesOnly, pullRequestDescriptionExcerpt }: KnowledgeDiffViewProps) => (
  <ViewBase
    diffId={diffId}
    viewType="knowledge"
    showChangesOnly={showChangesOnly}
    pullRequestDescriptionExcerpt={pullRequestDescriptionExcerpt}
  />
);

export default KnowledgeDiffView;
