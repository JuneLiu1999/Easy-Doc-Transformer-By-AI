export type AstNode = HeadingAstNode | ParagraphAstNode | ListAstNode | TableAstNode | ImageAstNode;

export type HeadingAstNode = {
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
};

export type ParagraphAstNode = {
  type: "paragraph";
  text: string;
};

export type ListAstNode = {
  type: "list";
  items: string[];
};

export type TableAstNode = {
  type: "table";
  rows: string[][];
};

export type ImageAstNode = {
  type: "image";
  src?: string;
  placeholder?: string;
};
