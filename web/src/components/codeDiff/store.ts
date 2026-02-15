import { makeAutoObservable } from "mobx";

export class CodeDiffDrawerStore {
  isFullscreen = false;
  currentHunkIdx = 0;
  textSearch = "";
  textSearchIdx = 0;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  setFullscreen(next: boolean): void {
    this.isFullscreen = next;
  }

  toggleFullscreen(): void {
    this.isFullscreen = !this.isFullscreen;
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
}
