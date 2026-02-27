import { z } from "zod";
import type { Block } from "../index";

const textStyleSchema = z.object({
  color: z.string().optional(),
  fontSize: z.string().optional(),
  fontWeight: z.string().optional(),
  textAlign: z.union([z.literal("left"), z.literal("center"), z.literal("right"), z.literal("justify")]).optional()
});

const headingBlockSchema = z.object({
  id: z.string(),
  type: z.literal("heading"),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  text: z.string(),
  textStyle: textStyleSchema.optional()
});

const paragraphBlockSchema = z.object({
  id: z.string(),
  type: z.literal("paragraph"),
  text: z.string(),
  textStyle: textStyleSchema.optional()
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
  caption: z.string().optional(),
  widthPercent: z.number().int().min(10).max(100).optional()
});

const chartBlockSchema = z.object({
  id: z.string(),
  type: z.literal("chart"),
  title: z.string().optional(),
  height: z.number().int().positive().max(1200).optional(),
  option: z.record(z.string(), z.unknown())
});

const richItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    text: z.string()
  }),
  z.object({
    kind: z.literal("image"),
    src: z.string(),
    alt: z.string().optional(),
    caption: z.string().optional(),
    widthPercent: z.number().int().min(10).max(100).optional()
  }),
  z.object({
    kind: z.literal("chart"),
    title: z.string().optional(),
    height: z.number().int().positive().max(1200).optional(),
    option: z.record(z.string(), z.unknown())
  })
]);

export const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("type", [
    headingBlockSchema,
    paragraphBlockSchema,
    dividerBlockSchema,
    imageBlockSchema,
    chartBlockSchema,
    z.object({
      id: z.string(),
      type: z.literal("rich"),
      items: z.array(richItemSchema)
    }),
    z.object({
      id: z.string(),
      type: z.literal("columns"),
      gap: z.number().int().positive().max(80).optional(),
      columns: z.array(
        z.object({
          id: z.string(),
          blocks: z.array(blockSchema)
        })
      )
    })
  ])
);

export type UpdateContentOp = {
  op: "update_content";
  id: string;
  content: string;
  textStyle?: {
    color?: string;
    fontSize?: string;
    fontWeight?: string;
    textAlign?: "left" | "center" | "right" | "justify";
  };
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
    content: z.string(),
    textStyle: textStyleSchema.optional()
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
