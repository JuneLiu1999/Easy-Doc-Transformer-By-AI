export type Block = HeadingBlock | ParagraphBlock | DividerBlock | ImageBlock;

export interface Page {
  id: string;
  title: string;
  blocks: Block[];
}

export interface HeadingBlock {
  id: string;
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
}

export interface ParagraphBlock {
  id: string;
  type: "paragraph";
  text: string;
}

export interface DividerBlock {
  id: string;
  type: "divider";
}

export interface ImageBlock {
  id: string;
  type: "image";
  src: string;
  alt?: string;
  caption?: string;
}

export { demoPage } from "./demoPage";
export { applyPatch } from "./applyPatch";
export { astToBlocks } from "./astToBlocks";
export type { Patch, PatchOp, UpdateContentOp, ReplaceBlockOp, InsertAfterOp, DeleteBlockOp } from "./types/patch";
export { patchSchema, patchOpSchema, blockSchema } from "./types/patch";
export type { AstNode, HeadingAstNode, ParagraphAstNode, ListAstNode, TableAstNode, ImageAstNode } from "./types/ast";

