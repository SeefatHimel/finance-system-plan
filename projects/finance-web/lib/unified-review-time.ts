/** SMS reception is a useful time only when it does not contradict the transaction date. */
export function proposedPairTime(
  statementDate: string | null,
  statementTime: string | null,
  receivedDate: string,
  receivedTime: string,
): string | null {
  if (statementTime) return statementTime;
  return !statementDate || statementDate === receivedDate ? receivedTime : null;
}

/** Do not carry an inferred SMS timestamp onto a different transaction date. */
export function timeAfterPairDateChange(
  statementTime: string | null,
  currentTime: string | null,
  nextDate: string | null,
  receivedDate: string,
  receivedTime: string,
): string | null {
  return !statementTime && currentTime === receivedTime && nextDate !== receivedDate
    ? null
    : currentTime;
}
