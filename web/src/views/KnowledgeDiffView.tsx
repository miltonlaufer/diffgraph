import { ViewBase } from "./ViewBase";

interface KnowledgeDiffViewProps {
  diffId: string;
  showChangesOnly: boolean;
}

const KnowledgeDiffView = ({ diffId, showChangesOnly }: KnowledgeDiffViewProps) => (
  <ViewBase diffId={diffId} viewType="knowledge" showChangesOnly={showChangesOnly} />
);

export default KnowledgeDiffView;
