"""Read-only comparison of a fresh PDF extraction with saved bKash rows."""

from decimal import Decimal, InvalidOperation

from .parser import PARSER_VERSION


def _same_money(left, right):
    try:
        return Decimal(str(left)) == Decimal(str(right))
    except (InvalidOperation, TypeError, ValueError):
        return left is None and right is None


def recheck_directions(batch, preview):
    saved = list(batch.rows.filter(component="principal").select_related("transaction").order_by("position"))
    fresh = preview.get("rows", [])
    if preview.get("profile") != "bkash" or len(saved) != len(fresh):
        raise ValueError("The saved rows no longer align with this PDF. Review the original manually; nothing was changed.")

    results = []
    for row, source in zip(saved, fresh, strict=True):
        old = row.extracted or {}
        identity_matches = (
            old.get("page") == source.get("page")
            and old.get("row") == source.get("row")
            and old.get("date") == source.get("date")
            and old.get("time") == source.get("time")
            and old.get("provider_type") == source.get("provider_type")
            and _same_money(old.get("amount"), source.get("amount"))
            and _same_money(old.get("balance_after"), source.get("balance_after"))
        )
        fresh_direction = source.get("direction") if identity_matches else None
        original_direction = old.get("direction")
        ledger_direction = None
        if row.transaction_id:
            entry = row.transaction
            if entry.type == "transfer" and entry.account_id == batch.account_id:
                ledger_direction = "debit"
            elif entry.type == "transfer" and entry.transfer_account_id == batch.account_id:
                ledger_direction = "credit"
            elif entry.account_id == batch.account_id:
                ledger_direction = entry.direction

        reasons = []
        if not identity_matches:
            reasons.append("Fresh extraction does not match this saved row's date, time, amount, balance or position. Compare the PDF manually.")
        else:
            if source.get("issues"):
                reasons.append("The fresh PDF extraction has a balance or source check that needs review.")
            if fresh_direction != original_direction and not row.reviewed_source_direction:
                reasons.append("Fresh PDF direction differs from the original saved extraction.")
            if row.reviewed_source_direction and fresh_direction != row.reviewed_source_direction:
                reasons.append("Fresh parser direction differs from your reviewed PDF direction. Check the original column again.")
            if fresh_direction != row.direction:
                reasons.append("Fresh PDF direction differs from the saved draft.")
            if ledger_direction and fresh_direction != ledger_direction:
                reasons.append("Fresh PDF direction differs from the linked ledger entry for this account.")
        if reasons:
            results.append({
                "row_id": str(row.id), "version": row.version, "page": old.get("page"), "source_row": old.get("row"),
                "date": old.get("date"), "time": old.get("time"), "amount": old.get("amount"),
                "balance_after": old.get("balance_after"), "original_direction": original_direction,
                "reviewed_direction": row.reviewed_source_direction or None,
                "fresh_direction": fresh_direction, "draft_direction": row.direction,
                "ledger_direction": ledger_direction, "transaction_id": str(row.transaction_id) if row.transaction_id else None,
                "state": row.state, "reasons": reasons,
            })

    return {"parser_version": PARSER_VERSION, "checked_rows": len(saved), "issues": results}
