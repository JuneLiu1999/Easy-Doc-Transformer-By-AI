"use client";

import { useParams } from "next/navigation";
import { EditorWorkspace } from "@/components/editorWorkspace";

export default function PageEditorRoute() {
  const params = useParams<{ pageId: string }>();
  const pageId = params?.pageId ?? "demo";
  return <EditorWorkspace initialPageId={pageId} />;
}
