export interface Page {
  id: string;
  title: string;
  blocks: Block[];
}

export interface TextStyle {
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  textAlign?: "left" | "center" | "right" | "justify";
}

export interface HeadingBlock {
  id: string;
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
  textStyle?: TextStyle;
}

export interface ParagraphBlock {
  id: string;
  type: "paragraph";
  text: string;
  textStyle?: TextStyle;
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
  widthPercent?: number;
}

export interface ChartBlock {
  id: string;
  type: "chart";
  title?: string;
  height?: number;
  option: Record<string, unknown>;
}

export interface RichTextItem {
  kind: "text";
  text: string;
}

export interface RichImageItem {
  kind: "image";
  src: string;
  alt?: string;
  caption?: string;
  widthPercent?: number;
}

export interface RichChartItem {
  kind: "chart";
  title?: string;
  height?: number;
  option: Record<string, unknown>;
}

export type RichItem = RichTextItem | RichImageItem | RichChartItem;

export interface RichBlock {
  id: string;
  type: "rich";
  items: RichItem[];
}

export interface ColumnsBlockColumn {
  id: string;
  blocks: Block[];
}

export interface ColumnsBlock {
  id: string;
  type: "columns";
  gap?: number;
  columns: ColumnsBlockColumn[];
}

export type Block = HeadingBlock | ParagraphBlock | DividerBlock | ImageBlock | ChartBlock | RichBlock | ColumnsBlock;

export { demoPage } from "./demoPage";
export { applyPatch } from "./applyPatch";
export { astToBlocks } from "./astToBlocks";
export type { Patch, PatchOp, UpdateContentOp, ReplaceBlockOp, InsertAfterOp, DeleteBlockOp } from "./types/patch";
export { patchSchema, patchOpSchema, blockSchema } from "./types/patch";
export type { AstNode, HeadingAstNode, ParagraphAstNode, ListAstNode, TableAstNode, ImageAstNode } from "./types/ast";
