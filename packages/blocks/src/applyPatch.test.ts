import test from "node:test";
import assert from "node:assert/strict";
import { applyPatch } from "./applyPatch";
import { demoPage } from "./demoPage";
import type { Page } from "./index";

function clonePage(): Page {
  return structuredClone(demoPage);
}

test("update_content success", () => {
  const original = clonePage();
  const updated = applyPatch(original, {
    ops: [{ op: "update_content", id: "p-intro", content: "Updated intro" }]
  });

  const block = updated.blocks.find((item) => item.id === "p-intro");
  assert.ok(block);
  assert.equal(block.type, "paragraph");
  assert.equal(block.text, "Updated intro");
  assert.notEqual(updated, original);
});

test("replace_block success", () => {
  const original = clonePage();
  const updated = applyPatch(original, {
    ops: [
      {
        op: "replace_block",
        id: "p-summary",
        block: {
          id: "p-summary",
          type: "heading",
          level: 2,
          text: "Replaced as heading"
        }
      }
    ]
  });

  const block = updated.blocks.find((item) => item.id === "p-summary");
  assert.ok(block);
  assert.equal(block.type, "heading");
});

test("insert_after success", () => {
  const original = clonePage();
  const updated = applyPatch(original, {
    ops: [
      {
        op: "insert_after",
        afterId: "p-intro",
        block: {
          id: "p-inserted",
          type: "paragraph",
          text: "Inserted content"
        }
      }
    ]
  });

  const introIndex = updated.blocks.findIndex((item) => item.id === "p-intro");
  assert.equal(updated.blocks[introIndex + 1]?.id, "p-inserted");
});

test("delete_block success", () => {
  const original = clonePage();
  const updated = applyPatch(original, {
    ops: [{ op: "delete_block", id: "divider-1" }]
  });

  assert.equal(updated.blocks.some((item) => item.id === "divider-1"), false);
  assert.equal(updated.blocks.length, original.blocks.length - 1);
});

test("update_content throws when target id does not exist", () => {
  const original = clonePage();
  assert.throws(
    () =>
      applyPatch(original, {
        ops: [{ op: "update_content", id: "missing-id", content: "X" }]
      }),
    /Block id not found: missing-id/
  );
});

test("insert_after throws when afterId does not exist", () => {
  const original = clonePage();
  assert.throws(
    () =>
      applyPatch(original, {
        ops: [
          {
            op: "insert_after",
            afterId: "missing-id",
            block: {
              id: "p-inserted",
              type: "paragraph",
              text: "Inserted content"
            }
          }
        ]
      }),
    /Block id not found: missing-id/
  );
});
