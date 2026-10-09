package com.personalfinance.smscapture

import org.json.JSONArray
import org.json.JSONObject

/** Merge the previous app queue into the native queue without changing import identities. */
internal fun mergeSmsQueues(captured: JSONArray, legacy: JSONArray): JSONArray {
  val result = JSONArray(captured.toString())
  val positions = mutableMapOf<String, JSONObject>()
  for (index in 0 until result.length()) {
    val item = result.getJSONObject(index)
    positions[item.getString("id")] = item
  }
  for (index in 0 until legacy.length()) {
    // Throw on malformed records so the original encrypted queue is retained.
    val item = legacy.getJSONObject(index)
    val deviceId = item.optString("deviceMessageId")
    val id = if (deviceId.startsWith("native:")) deviceId.removePrefix("native:")
      else "legacy:${item.getString("id")}"
    val existing = positions[id]
    if (existing != null) {
      if (item.optBoolean("reprocessExisting")) {
        existing.put("reprocessExisting", true)
        existing.remove("rejected")
      }
      continue
    }
    val migrated = JSONObject()
      .put("id", id)
      .put("sender", item.getString("sender"))
      .put("body", item.getString("body"))
      .put("receivedAt", item.getString("receivedAt"))
      .put("deviceMessageId", deviceId)
      .put("reprocessExisting", item.optBoolean("reprocessExisting"))
    result.put(migrated)
    positions[id] = migrated
  }
  return result
}

internal fun isRetryableSmsResponse(code: Int): Boolean =
  code == 408 || code == 429 || code >= 500
