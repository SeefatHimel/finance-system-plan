package com.personalfinance.smscapture

import android.content.Context
import android.provider.Telephony
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.util.Locale

object FinanceSmsStore {
  private const val PREFS_NAME = "finance_sms_capture"
  private const val KEY_MESSAGES = "captured_messages"
  private const val KEY_PROCESSED_MESSAGE_IDS = "processed_message_ids"
  private const val KEY_RULES = "sender_rules"
  private const val MAX_HISTORY_ROWS = 5000
  private const val MAX_PROCESSED_MESSAGE_IDS = 10000

  enum class AppendStatus {
    CAPTURED,
    DUPLICATE,
    UNTRACKED
  }

  data class SenderRule(
    val id: String,
    val matchType: String,
    val sender: String
  )

  fun configureRules(context: Context, rules: List<SenderRule>) {
    val payload = JSONArray()
    rules
      .filter { it.sender.isNotBlank() }
      .forEach { rule ->
        payload.put(
          JSONObject()
            .put("id", rule.id)
            .put("matchType", rule.matchType)
            .put("sender", rule.sender)
        )
      }

    prefs(context).edit().putString(KEY_RULES, payload.toString()).apply()
  }

  @Synchronized
  fun appendIfTracked(context: Context, sender: String, body: String, receivedAtMillis: Long): AppendStatus {
    if (sender.isBlank() || body.isBlank() || !matchesEnabledRule(context, sender)) {
      return AppendStatus.UNTRACKED
    }

    val receivedAt = isoFromMillis(receivedAtMillis)
    val stableId = stableMessageId(sender, body, receivedAtMillis)
    val preferences = prefs(context)
    val processedIds = preferences.getStringSet(KEY_PROCESSED_MESSAGE_IDS, emptySet()).orEmpty()
    if (processedIds.contains(stableId)) {
      return AppendStatus.DUPLICATE
    }

    val messages = JSONArray(preferences.getString(KEY_MESSAGES, "[]"))

    for (index in 0 until messages.length()) {
      val current = messages.optJSONObject(index) ?: continue
      if (current.optString("id") == stableId) {
        rememberProcessedId(context, stableId)
        return AppendStatus.DUPLICATE
      }
    }

    messages.put(
      JSONObject()
        .put("id", stableId)
        .put("sender", sender)
        .put("body", body)
        .put("receivedAt", receivedAt)
    )
    preferences.edit().putString(KEY_MESSAGES, messages.toString()).apply()
    rememberProcessedId(context, stableId)
    return AppendStatus.CAPTURED
  }

  fun scanHistoricalMessages(context: Context, limit: Int): Map<String, Int> {
    val boundedLimit = limit.coerceIn(1, 1000)
    val projection = arrayOf(
      Telephony.Sms.ADDRESS,
      Telephony.Sms.BODY,
      Telephony.Sms.DATE,
      Telephony.Sms.DATE_SENT
    )
    var capturedCount = 0
    var duplicateCount = 0
    var scannedCount = 0

    context.contentResolver.query(
      Telephony.Sms.Inbox.CONTENT_URI,
      projection,
      null,
      null,
      "${Telephony.Sms.DATE} DESC"
    )?.use { cursor ->
      val senderIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
      val bodyIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.BODY)
      val dateIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)
      val dateSentIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE_SENT)

      while (cursor.moveToNext() && scannedCount < MAX_HISTORY_ROWS && capturedCount < boundedLimit) {
        scannedCount += 1
        val sender = cursor.getString(senderIndex).orEmpty()
        val body = cursor.getString(bodyIndex).orEmpty()
        val sentAtMillis = cursor.getLong(dateSentIndex)
        val receivedAtMillis = if (sentAtMillis > 0L) sentAtMillis else cursor.getLong(dateIndex)

        when (appendIfTracked(context, sender, body, receivedAtMillis)) {
          AppendStatus.CAPTURED -> capturedCount += 1
          AppendStatus.DUPLICATE -> duplicateCount += 1
          AppendStatus.UNTRACKED -> Unit
        }
      }
    }

    return mapOf(
      "capturedCount" to capturedCount,
      "duplicateCount" to duplicateCount,
      "scannedCount" to scannedCount
    )
  }

  fun getMessages(context: Context, limit: Int): List<Map<String, String>> {
    val messages = JSONArray(prefs(context).getString(KEY_MESSAGES, "[]"))
    val boundedLimit = limit.coerceIn(1, 1000)
    val start = (messages.length() - boundedLimit).coerceAtLeast(0)
    val result = mutableListOf<Map<String, String>>()

    for (index in start until messages.length()) {
      val item = messages.optJSONObject(index) ?: continue
      result.add(
        mapOf(
          "id" to item.optString("id"),
          "sender" to item.optString("sender"),
          "body" to item.optString("body"),
          "receivedAt" to item.optString("receivedAt")
        )
      )
    }

    return result
  }

  fun clearMessages(context: Context, ids: List<String>) {
    if (ids.isEmpty()) {
      return
    }

    val idSet = ids.toSet()
    val messages = JSONArray(prefs(context).getString(KEY_MESSAGES, "[]"))
    val remaining = JSONArray()

    for (index in 0 until messages.length()) {
      val item = messages.optJSONObject(index) ?: continue
      if (!idSet.contains(item.optString("id"))) {
        remaining.put(item)
      }
    }

    prefs(context).edit().putString(KEY_MESSAGES, remaining.toString()).apply()
  }

  private fun matchesEnabledRule(context: Context, sender: String): Boolean {
    val rules = JSONArray(prefs(context).getString(KEY_RULES, "[]"))
    val normalizedSender = normalize(sender)

    for (index in 0 until rules.length()) {
      val rule = rules.optJSONObject(index) ?: continue
      val pattern = normalize(rule.optString("sender"))
      if (pattern.isBlank()) {
        continue
      }

      val matches = when (normalize(rule.optString("matchType"))) {
        "contains" -> normalizedSender.contains(pattern)
        "prefix", "starts_with" -> normalizedSender.startsWith(pattern)
        else -> normalizedSender == pattern
      }

      if (matches) {
        return true
      }
    }

    return false
  }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun normalize(value: String) = value.trim().lowercase(Locale.US)

  private fun rememberProcessedId(context: Context, id: String) {
    val preferences = prefs(context)
    val processedIds = preferences
      .getStringSet(KEY_PROCESSED_MESSAGE_IDS, emptySet())
      .orEmpty()
      .toMutableSet()

    if (processedIds.size >= MAX_PROCESSED_MESSAGE_IDS) {
      processedIds.clear()
    }
    processedIds.add(id)
    preferences.edit().putStringSet(KEY_PROCESSED_MESSAGE_IDS, processedIds).apply()
  }

  private fun stableMessageId(sender: String, body: String, receivedAtMillis: Long): String {
    val payload = "${normalize(sender)}:$receivedAtMillis:${body.trim()}"
    val digest = MessageDigest.getInstance("SHA-256").digest(payload.toByteArray(Charsets.UTF_8))
    return "sms:${digest.joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }}"
  }

  private fun isoFromMillis(value: Long): String {
    return java.time.Instant.ofEpochMilli(value).toString()
  }
}
