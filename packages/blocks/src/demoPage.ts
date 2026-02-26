import type { Page } from "./index";

export const demoPage: Page = {
  id: "demo",
  title: "MVP-0 Demo Report",
  blocks: [
    {
      id: "h1-overview",
      type: "heading",
      level: 1,
      text: "Weekly Operations Report"
    },
    {
      id: "p-intro",
      type: "paragraph",
      text: "This report is generated from Block JSON as the source of truth and rendered by dedicated clients."
    },
    {
      id: "divider-1",
      type: "divider"
    },
    {
      id: "p-summary",
      type: "paragraph",
      text: "Export creates a static site bundle that can be hosted directly by Nginx or Caddy."
    }
  ]
};

