package com.personalfinance.smscapture

import org.json.JSONArray
import org.json.JSONObject

/** Build a replacement without mutating storage or acknowledging newer reprocessing choices. */
internal fun applySmsUploadReceipts(messages: JSONArray, results: List<SmsUploadOutcome>): JSONArray {
  val byId = results.associateBy { it.message.getValue("id") }
  require(byId.size == results.size)
  val remaining = JSONArray()
  for (index in 0 until messages.length()) {
    val item = JSONObject(messages.getJSONObject(index).toString())
    val result = byId[item.optString("id")]
    val sameAttempt = result != null &&
      item.optBoolean("reprocessExisting") == result.message.getValue("reprocessExisting").toBoolean() &&
      item.optBoolean("restoreRedacted") == (result.message["restoreRedacted"]?.toBoolean() ?: false)
    if (!sameAttempt) { remaining.put(item); continue }
    val receipt = result!!
    when {
      receipt.code in 200..299 -> Unit
      isRetryableSmsResponse(receipt.code) -> remaining.put(item.put("retryAt", receipt.retryAt).put("httpCode", receipt.code))
      else -> remaining.put(item.put("rejected", true).put("httpCode", receipt.code))
    }
  }
  return remaining
}
