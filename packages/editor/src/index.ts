export interface UndoOperation {
  id: string;
  description: string;
}

export { useBlockSelection, type SelectionRect } from "./useBlockSelection";
