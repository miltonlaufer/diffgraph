import { makeAutoObservable } from "mobx";

export class FileListPanelStore {
  collapsed = false;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  toggleCollapsed(): void {
    this.collapsed = !this.collapsed;
  }
}
