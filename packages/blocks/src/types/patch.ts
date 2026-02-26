import { z } from "zod";
import type { Block } from "../index";

const headingBlockSchema = z.object({
  id: z.string(),
  type: z.literal("heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string()
});

const paragraphBlockSchema = z.object({
  id: z.string(),
  type: z.literal("paragraph"),
  text: z.string()
});

const dividerBlockSchema = z.object({
  id: z.string(),
  type: z.literal("divider")
});

const imageBlockSchema = z.object({
  id: z.string(),
  type: z.literal("image"),
  src: z.string(),
  alt: z.string().optional(),
  caption: z.string().optional()
});

export const blockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  dividerBlockSchema,
  imageBlockSchema
]);

export type UpdateContentOp = {
  op: "update_content";
  id: string;
  content: string;
};

export type ReplaceBlockOp = {
  op: "replace_block";
  id: string;
  block: Block;
};

export type InsertAfterOp = {
  op: "insert_after";
  afterId: string;
  block: Block;
};

export type DeleteBlockOp = {
  op: "delete_block";
  id: string;
};

export type PatchOp = UpdateContentOp | ReplaceBlockOp | InsertAfterOp | DeleteBlockOp;

export type Patch = {
  ops: PatchOp[];
};

export const patchOpSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update_content"),
    id: z.string(),
    content: z.string()
  }),
  z.object({
    op: z.literal("replace_block"),
    id: z.string(),
    block: blockSchema
  }),
  z.object({
    op: z.literal("insert_after"),
    afterId: z.string(),
    block: blockSchema
  }),
  z.object({
    op: z.literal("delete_block"),
    id: z.string()
  })
]);

export const patchSchema = z.object({
  ops: z.array(patchOpSchema)
});
