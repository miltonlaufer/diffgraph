import type { MutableRefObject } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { SplitGraphPanel } from "#/components/SplitGraphPanel";
import type { TopLevelAnchor } from "#/components/SplitGraphPanel";
import type { ViewGraph } from "#/types/graph";
import type { ViewBaseStoreInstance } from "./store";

const EMPTY_ANCHORS: Record<string, TopLevelAnchor> = {};

export interface AlignedTopAnchors {
  old: Record<string, TopLevelAnchor> | undefined;
  new: Record<string, TopLevelAnchor> | undefined;
}

interface AlignmentBreakpoint {
  sourceY: number;
  deltaY: number;
}

interface GraphSectionProps {
  graphSectionRef: MutableRefObject<HTMLDivElement | null>;
  loading: boolean;
  isEmptyView: boolean;
  selectedFilePath: string;
  renderOldGraph: boolean;
  renderNewGraph: boolean;
  displayOldGraph: ViewGraph;
  displayNewGraph: ViewGraph;
  oldFileContentMap: Map<string, string>;
  newFileContentMap: Map<string, string>;
  alignedTopAnchors: AlignedTopAnchors;
  newAlignmentOffset: { x: number; y: number } | undefined;
  alignmentBreakpoints: Record<string, AlignmentBreakpoint[]> | undefined;
  store: ViewBaseStoreInstance;
}

export const GraphSection = ({
  graphSectionRef,
  loading,
  isEmptyView,
  selectedFilePath,
  renderOldGraph,
  renderNewGraph,
  displayOldGraph,
  displayNewGraph,
  oldFileContentMap,
  newFileContentMap,
  alignedTopAnchors,
  newAlignmentOffset,
  alignmentBreakpoints,
  store,
}: GraphSectionProps) => (
  <div ref={graphSectionRef} className="viewResizablePanelInner">
    {loading && (
      <div className="loadingContainer">
        <div className="spinner" />
        <p className="dimText">Analyzing code and building graphs...</p>
      </div>
    )}
    {!loading && isEmptyView && (
      <p className="errorText">
        {selectedFilePath
          ? "No nodes found for this file. Try the Knowledge tab, or disable Changes Only."
          : "No nodes found for this view. Try the Knowledge tab, or disable Changes Only."}
      </p>
    )}
    {!loading && !isEmptyView && renderOldGraph && renderNewGraph && (
      <Group id="graph-split" orientation="horizontal" className="splitLayoutResizable">
        <Panel id="old" defaultSize={50} minSize={20} className="viewResizablePanel">
          <div className="splitLayoutPanelInner">
            <SplitGraphPanel
              title="Old"
              side="old"
              graph={displayOldGraph}
              counterpartGraph={displayNewGraph}
              showCalls={store.viewType === "logic" ? store.showCalls : true}
              fileContentMap={oldFileContentMap}
              counterpartFileContentMap={newFileContentMap}
              alignmentAnchors={alignedTopAnchors.old ?? EMPTY_ANCHORS}
              isViewportPrimary={!renderNewGraph}
            />
          </div>
        </Panel>
        <Separator id="graph-separator" className="viewResizeSeparator viewResizeSeparatorHorizontal" />
        <Panel id="new" defaultSize={50} minSize={20} className="viewResizablePanel">
          <div className="splitLayoutPanelInner">
            <SplitGraphPanel
              title="New"
              side="new"
              graph={displayNewGraph}
              counterpartGraph={displayOldGraph}
              showCalls={store.viewType === "logic" ? store.showCalls : true}
              fileContentMap={newFileContentMap}
              counterpartFileContentMap={oldFileContentMap}
              alignmentOffset={newAlignmentOffset}
              alignmentAnchors={alignedTopAnchors.new ?? EMPTY_ANCHORS}
              alignmentBreakpoints={alignmentBreakpoints}
              isViewportPrimary
            />
          </div>
        </Panel>
      </Group>
    )}
    {!loading && !isEmptyView && renderOldGraph !== renderNewGraph && (
      <div className={renderOldGraph && renderNewGraph ? "splitLayout" : "splitLayout splitLayoutSingle"}>
        {renderOldGraph && (
          <SplitGraphPanel
            title="Old"
            side="old"
            graph={displayOldGraph}
            counterpartGraph={displayNewGraph}
            showCalls={store.viewType === "logic" ? store.showCalls : true}
            fileContentMap={oldFileContentMap}
            counterpartFileContentMap={newFileContentMap}
            alignmentAnchors={alignedTopAnchors.old ?? EMPTY_ANCHORS}
            isViewportPrimary={!renderNewGraph}
          />
        )}
        {renderNewGraph && (
          <SplitGraphPanel
            title="New"
            side="new"
            graph={displayNewGraph}
            counterpartGraph={displayOldGraph}
            showCalls={store.viewType === "logic" ? store.showCalls : true}
            fileContentMap={newFileContentMap}
            counterpartFileContentMap={oldFileContentMap}
            alignmentOffset={newAlignmentOffset}
            alignmentAnchors={alignedTopAnchors.new ?? EMPTY_ANCHORS}
            alignmentBreakpoints={alignmentBreakpoints}
            isViewportPrimary
          />
        )}
      </div>
    )}
  </div>
);
