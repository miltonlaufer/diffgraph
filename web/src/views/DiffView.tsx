import { ViewBase } from "./ViewBase";
import type { ViewType } from "./viewBase/types";

interface DiffViewProps {
  diffId: string;
  viewType: ViewType;
  showChangesOnly: boolean;
  pullRequestDescriptionExcerpt?: string;
}

const DiffView = ({
  diffId,
  viewType,
  showChangesOnly,
  pullRequestDescriptionExcerpt,
}: DiffViewProps) => (
  <ViewBase
    diffId={diffId}
    viewType={viewType}
    showChangesOnly={showChangesOnly}
    pullRequestDescriptionExcerpt={pullRequestDescriptionExcerpt}
  />
);

export default DiffView;
