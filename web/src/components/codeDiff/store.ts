import { makeAutoObservable } from "mobx";

export class CodeDiffDrawerStore {
  isFullscreen = false;
  currentHunkIdx = 0;
  textSearch = "";
  textSearchIdx = 0;
  codeLogicTreeMode = false;
  codeLogicTreeSide: "old" | "new" = "new";
  codeLogicTreeLines: number[] = [];

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  setFullscreen(next: boolean): void {
    this.isFullscreen = next;
    if (!next) {
      this.clearCodeLogicTreeMode();
    }
  }

  toggleFullscreen(): void {
    this.setFullscreen(!this.isFullscreen);
  }

  setCurrentHunkIdx(idx: number): void {
    this.currentHunkIdx = idx;
  }

  resetHunkIdx(): void {
    this.currentHunkIdx = 0;
  }

  setTextSearch(query: string): void {
    this.textSearch = query;
    this.textSearchIdx = 0;
  }

  setTextSearchIdx(idx: number): void {
    this.textSearchIdx = idx;
  }

  setCodeLogicTreeMode(side: "old" | "new", lines: number[]): void {
    this.codeLogicTreeMode = true;
    this.codeLogicTreeSide = side;
    this.codeLogicTreeLines = lines;
  }

  clearCodeLogicTreeMode(): void {
    this.codeLogicTreeMode = false;
    this.codeLogicTreeLines = [];
    this.codeLogicTreeSide = "new";
  }
}
