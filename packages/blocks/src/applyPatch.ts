import type { Block, Page } from "./index";
import type { Patch } from "./types/patch";

function findBlockIndex(blocks: Block[], id: string): number {
  return blocks.findIndex((block) => block.id === id);
}

function updateBlockContent(block: Block, content: string): Block {
  if (block.type === "heading" || block.type === "paragraph") {
    return { ...block, text: content };
  }

  if (block.type === "image") {
    return { ...block, caption: content };
  }

  throw new Error(`Block "${block.id}" does not support content updates`);
}

export function applyPatch(page: Page, patch: Patch): Page {
  let blocks = [...page.blocks];

  for (const op of patch.ops) {
    if (op.op === "update_content") {
      const index = findBlockIndex(blocks, op.id);
      if (index < 0) {
        throw new Error(`Block id not found: ${op.id}`);
      }
      blocks = [...blocks];
      blocks[index] = updateBlockContent(blocks[index], op.content);
      continue;
    }

    if (op.op === "replace_block") {
      const index = findBlockIndex(blocks, op.id);
      if (index < 0) {
        throw new Error(`Block id not found: ${op.id}`);
      }
      blocks = [...blocks];
      blocks[index] = op.block;
      continue;
    }

    if (op.op === "insert_after") {
      const index = findBlockIndex(blocks, op.afterId);
      if (index < 0) {
        throw new Error(`Block id not found: ${op.afterId}`);
      }
      blocks = [...blocks.slice(0, index + 1), op.block, ...blocks.slice(index + 1)];
      continue;
    }

    const index = findBlockIndex(blocks, op.id);
    if (index < 0) {
      throw new Error(`Block id not found: ${op.id}`);
    }
    blocks = [...blocks.slice(0, index), ...blocks.slice(index + 1)];
  }

  return {
    ...page,
    blocks
  };
}
