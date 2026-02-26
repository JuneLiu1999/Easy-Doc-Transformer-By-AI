import type { Block, Page, Patch } from "@packages/blocks";

function getBlockContent(block: Block): string {
  if (block.type === "heading" || block.type === "paragraph") {
    return block.text;
  }

  if (block.type === "image") {
    return block.caption ?? "";
  }

  return "";
}

function getBlockById(page: Page, id: string): Block | undefined {
  return page.blocks.find((block) => block.id === id);
}

export function mockAiGeneratePatch(page: Page, selectedBlockIds: string[], instruction: string): Patch {
  const targetId = selectedBlockIds[0];
  const targetBlock = getBlockById(page, targetId);
  const currentContent = targetBlock ? getBlockContent(targetBlock) : "";

  if (instruction.includes("\u52a0\u7c97") || instruction.toLowerCase().includes("bold")) {
    return {
      ops: [
        {
          op: "update_content",
          id: targetId,
          content: `[BOLD] ${currentContent}`.trim()
        }
      ]
    };
  }

  if (instruction.includes("\u66ff\u6362\u6807\u9898")) {
    return {
      ops: [
        {
          op: "replace_block",
          id: targetId,
          block: {
            id: targetId,
            type: "heading",
            level: 2,
            text: "AI Replaced Heading"
          }
        }
      ]
    };
  }

  const content = currentContent ? `${currentContent}\n(AI edited)` : "(AI edited)";
  return {
    ops: [
      {
        op: "update_content",
        id: targetId,
        content
      }
    ]
  };
}
