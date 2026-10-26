import { ActivityIndicator, Text, View } from "react-native";
import { ActionButton, useMobileUi } from "./mobile-ui";
import type { useReviewMutation } from "./review-mutation";
import type { ParsedMessageCandidate } from "./api";

export function ReviewSaveNotice({ review, candidates, onReview, onEdit }: {
  review: ReturnType<typeof useReviewMutation>; onReview: (id: string) => void; onEdit: (id: string) => void;
  candidates: ParsedMessageCandidate[];
}) {
  const ui = useMobileUi();
  const operation = review.operation;
  if (!operation) return null;
  const failed = operation.phase === "failed", unknown = operation.phase === "unknown";
  const restored = operation.snapshots.find(item => candidates.some(row => row.id === item.candidate.id));
  return <View style={[ui.card, { margin: 8, padding: 12 }]}>
    {review.busy ? <ActivityIndicator color="#55e6a5" /> : null}
    <Text accessibilityLiveRegion="polite" accessibilityRole={failed || unknown ? "alert" : "text"}
      style={failed || unknown ? ui.error : ui.text}>{operation.message}</Text>
    <View style={ui.row}>
      {unknown ? <ActionButton label="Check save status" disabled={review.busy} onPress={() => void review.check()} /> : null}
      {failed || unknown ? <ActionButton label="Retry same decision" disabled={review.busy} onPress={() => void review.retry()} /> : null}
      {failed && restored ? <ActionButton label="Review restored message" onPress={() => onReview(restored.candidate.id)} /> : null}
      {operation.resultTransaction ? <ActionButton label="View saved transaction" onPress={() => onEdit(operation.resultTransaction!)} /> : null}
      {!review.blocked ? <ActionButton label="Dismiss review notice" onPress={review.dismiss} /> : null}
    </View>
  </View>;
}
