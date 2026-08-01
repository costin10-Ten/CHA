"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { resolveFeedback } from "@/app/review/feedback-actions";
import { Button } from "@/components/ui/button";

export function FeedbackResolveButton({
  feedbackId,
  resolved,
}: {
  feedbackId: string;
  resolved: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await resolveFeedback(feedbackId, !resolved);
          router.refresh();
        })
      }
    >
      {resolved ? "改回未處理" : "標記為已處理"}
    </Button>
  );
}
