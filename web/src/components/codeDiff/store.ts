import { types } from "mobx-state-tree";

export const CodeDiffDrawerStore = types
  .model("CodeDiffDrawerStore", {
    isFullscreen: types.optional(types.boolean, false),
    currentHunkIdx: types.optional(types.number, 0),
    textSearch: types.optional(types.string, ""),
    textSearchIdx: types.optional(types.number, 0),
    codeLogicTreeMode: types.optional(types.boolean, false),
    codeLogicTreeSide: types.optional(types.enumeration(["old", "new"]), "new"),
    codeLogicTreeLines: types.optional(types.array(types.number), []),
  })
  .actions((self) => ({
    setFullscreen(next: boolean) {
      self.isFullscreen = next;
      if (!next) {
        self.codeLogicTreeMode = false;
        self.codeLogicTreeLines.clear();
        self.codeLogicTreeSide = "new";
      }
    },

    toggleFullscreen() {
      self.isFullscreen = !self.isFullscreen;
      if (!self.isFullscreen) {
        self.codeLogicTreeMode = false;
        self.codeLogicTreeLines.clear();
        self.codeLogicTreeSide = "new";
      }
    },

    setCurrentHunkIdx(idx: number) {
      self.currentHunkIdx = idx;
    },

    resetHunkIdx() {
      self.currentHunkIdx = 0;
    },

    setTextSearch(query: string) {
      self.textSearch = query;
      self.textSearchIdx = 0;
    },

    setTextSearchIdx(idx: number) {
      self.textSearchIdx = idx;
    },

    setCodeLogicTreeMode(side: "old" | "new", lines: number[]) {
      self.codeLogicTreeMode = true;
      self.codeLogicTreeSide = side;
      self.codeLogicTreeLines.replace(lines);
    },

    clearCodeLogicTreeMode() {
      self.codeLogicTreeMode = false;
      self.codeLogicTreeLines.clear();
      self.codeLogicTreeSide = "new";
    },
  }));

export type CodeDiffDrawerStoreInstance = typeof CodeDiffDrawerStore.Type;
