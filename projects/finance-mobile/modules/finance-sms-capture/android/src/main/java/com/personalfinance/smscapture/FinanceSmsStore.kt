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
  private const val KEY_REACT_RAW_QUEUE = "react_raw_message_queue"
  private const val KEY_PROCESSED_MESSAGE_IDS = "processed_message_ids"
  private const val KEY_RULES = "sender_rules"
  private const val KEY_SYNC_SESSION = "sync_session"
  private const val KEY_SYNC_STATUS = "sync_status"
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
    val sender: String,
    val pattern: String,
    val isActive: Boolean
  )

  data class SyncSession(
    val apiBaseUrl: String,
    val accessToken: String,
    val refreshToken: String,
    val username: String
  )

  private data class InboxSenderSummary(
    val sender: String,
    var messageCount: Int,
    var latestAtMillis: Long
  )

  fun configureRules(context: Context, rules: List<SenderRule>) {
    val payload = JSONArray()
    rules
      .filter { it.isActive && it.sender.isNotBlank() }
      .forEach { rule ->
        payload.put(
          JSONObject()
            .put("id", rule.id)
            .put("matchType", rule.matchType)
            .put("sender", rule.sender)
            .put("pattern", rule.pattern)
            .put("isActive", rule.isActive)
        )
      }

    prefs(context).edit().putString(KEY_RULES, payload.toString()).apply()
  }

  @Synchronized
  fun appendIfTracked(
    context: Context,
    sender: String,
    body: String,
    receivedAtMillis: Long,
    includeProcessed: Boolean = false
  ): AppendStatus {
    if (sender.isBlank() || body.isBlank() || !matchesEnabledRule(context, sender)) {
      return AppendStatus.UNTRACKED
    }

    val receivedAt = isoFromMillis(receivedAtMillis)
    val stableId = stableMessageId(sender, body, receivedAtMillis)
    val processedIds = processedMessageIds(context)
    if (!includeProcessed && processedIds.contains(stableId)) {
      return AppendStatus.DUPLICATE
    }

    val messages = JSONArray(readEncryptedPreference(context, KEY_MESSAGES, "[]"))

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
    writeEncryptedPreference(context, KEY_MESSAGES, messages.toString())
    rememberProcessedId(context, stableId)
    return AppendStatus.CAPTURED
  }

  fun scanHistoricalMessages(
    context: Context,
    limit: Int,
    fromTimestamp: Long?,
    toTimestamp: Long?,
    includeProcessed: Boolean
  ): Map<String, Int> {
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

    val selectionParts = mutableListOf<String>()
    val selectionArguments = mutableListOf<String>()
    if (fromTimestamp != null) {
      selectionParts.add("${Telephony.Sms.DATE} >= ?")
      selectionArguments.add(fromTimestamp.toString())
    }
    if (toTimestamp != null) {
      selectionParts.add("${Telephony.Sms.DATE} <= ?")
      selectionArguments.add(toTimestamp.toString())
    }

    context.contentResolver.query(
      Telephony.Sms.Inbox.CONTENT_URI,
      projection,
      selectionParts.takeIf { it.isNotEmpty() }?.joinToString(" AND "),
      selectionArguments.takeIf { it.isNotEmpty() }?.toTypedArray(),
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

        when (appendIfTracked(context, sender, body, receivedAtMillis, includeProcessed)) {
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

  fun listInboxSenders(context: Context, limit: Int): List<Map<String, Any>> {
    val boundedLimit = limit.coerceIn(1, MAX_HISTORY_ROWS)
    val projection = arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.DATE)
    val senders = linkedMapOf<String, InboxSenderSummary>()
    var scannedCount = 0

    context.contentResolver.query(
      Telephony.Sms.Inbox.CONTENT_URI,
      projection,
      null,
      null,
      "${Telephony.Sms.DATE} DESC"
    )?.use { cursor ->
      val senderIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
      val dateIndex = cursor.getColumnIndexOrThrow(Telephony.Sms.DATE)

      while (cursor.moveToNext() && scannedCount < boundedLimit) {
        scannedCount += 1
        val sender = cursor.getString(senderIndex).orEmpty().trim()
        if (sender.isBlank()) {
          continue
        }

        val receivedAtMillis = cursor.getLong(dateIndex)
        val key = normalize(sender)
        val summary = senders[key]
        if (summary == null) {
          senders[key] = InboxSenderSummary(sender, 1, receivedAtMillis)
        } else {
          summary.messageCount += 1
          summary.latestAtMillis = maxOf(summary.latestAtMillis, receivedAtMillis)
        }
      }
    }

    return senders.values
      .sortedByDescending { it.latestAtMillis }
      .map { summary ->
        mapOf(
          "sender" to summary.sender,
          "messageCount" to summary.messageCount,
          "latestAt" to isoFromMillis(summary.latestAtMillis)
        )
      }
  }

  @Synchronized
  fun getMessages(context: Context, limit: Int): List<Map<String, String>> {
    val messages = JSONArray(readEncryptedPreference(context, KEY_MESSAGES, "[]"))
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

  @Synchronized
  fun clearMessages(context: Context, ids: List<String>) {
    if (ids.isEmpty()) {
      return
    }

    val idSet = ids.toSet()
    val messages = JSONArray(readEncryptedPreference(context, KEY_MESSAGES, "[]"))
    val remaining = JSONArray()

    for (index in 0 until messages.length()) {
      val item = messages.optJSONObject(index) ?: continue
      if (!idSet.contains(item.optString("id"))) {
        remaining.put(item)
      }
    }

    writeEncryptedPreference(context, KEY_MESSAGES, remaining.toString())
  }

  fun getSecureRawQueue(context: Context): String =
    readEncryptedPreference(context, KEY_REACT_RAW_QUEUE, "[]")

  fun setSecureRawQueue(context: Context, value: String) {
    writeEncryptedPreference(context, KEY_REACT_RAW_QUEUE, value)
  }

  fun configureSyncSession(
    context: Context,
    apiBaseUrl: String,
    accessToken: String,
    refreshToken: String,
    username: String
  ) {
    val payload = JSONObject()
      .put("apiBaseUrl", apiBaseUrl.trimEnd('/'))
      .put("accessToken", accessToken)
      .put("refreshToken", refreshToken)
      .put("username", username)
    writeEncryptedPreference(context, KEY_SYNC_SESSION, payload.toString())
  }

  fun getSyncSession(context: Context): SyncSession? {
    val payload = readEncryptedPreference(context, KEY_SYNC_SESSION, "")
    if (payload.isBlank()) {
      return null
    }
    val parsed = runCatching { JSONObject(payload) }.getOrNull() ?: return null
    val apiBaseUrl = parsed.optString("apiBaseUrl").trimEnd('/')
    val accessToken = parsed.optString("accessToken")
    val refreshToken = parsed.optString("refreshToken")
    val username = parsed.optString("username")
    if (apiBaseUrl.isBlank() || accessToken.isBlank() || refreshToken.isBlank() || username.isBlank()) {
      return null
    }
    return SyncSession(apiBaseUrl, accessToken, refreshToken, username)
  }

  fun clearSyncSession(context: Context) {
    prefs(context).edit().remove(KEY_SYNC_SESSION).apply()
  }

  fun setSyncStatus(
    context: Context,
    state: String,
    message: String,
    importedCount: Int = 0,
    rejectedCount: Int = 0
  ) {
    val payload = JSONObject()
      .put("state", state)
      .put("message", message)
      .put("importedCount", importedCount)
      .put("rejectedCount", rejectedCount)
      .put("updatedAt", isoFromMillis(System.currentTimeMillis()))
    prefs(context).edit().putString(KEY_SYNC_STATUS, payload.toString()).apply()
  }

  fun getSyncStatus(context: Context): Map<String, Any> {
    val payload = runCatching {
      JSONObject(prefs(context).getString(KEY_SYNC_STATUS, "{}"))
    }.getOrElse { JSONObject() }
    return mapOf(
      "state" to payload.optString("state", "idle"),
      "message" to payload.optString("message", "No background sync has run yet."),
      "importedCount" to payload.optInt("importedCount", 0),
      "rejectedCount" to payload.optInt("rejectedCount", 0),
      "updatedAt" to payload.optString("updatedAt", "")
    )
  }

  fun resetTrackingState(context: Context) {
    prefs(context)
      .edit()
      .remove(KEY_MESSAGES)
      .remove(KEY_PROCESSED_MESSAGE_IDS)
      .remove(KEY_REACT_RAW_QUEUE)
      .remove(KEY_SYNC_STATUS)
      .apply()
  }

  private fun matchesEnabledRule(context: Context, sender: String): Boolean {
    val rules = JSONArray(prefs(context).getString(KEY_RULES, "[]"))
    val normalizedSender = normalize(sender)

    for (index in 0 until rules.length()) {
      val rule = rules.optJSONObject(index) ?: continue
      if (!rule.optBoolean("isActive", true)) {
        continue
      }
      val ruleSender = rule.optString("sender")
      val configuredPattern = rule.optString("pattern")
      val normalizedPattern = normalize(if (configuredPattern.isNotBlank()) configuredPattern else ruleSender)
      if (normalizedPattern.isBlank()) {
        continue
      }

      val matches = when (normalize(rule.optString("matchType"))) {
        "contains" -> normalizedSender.contains(normalizedPattern)
        "regex" -> runCatching {
          Regex(configuredPattern.ifBlank { ruleSender }, RegexOption.IGNORE_CASE).containsMatchIn(sender.trim())
        }.getOrDefault(false)
        else -> normalizedSender == normalize(ruleSender)
      }

      if (matches) {
        return true
      }
    }

    return false
  }

  private fun prefs(context: Context) = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun readEncryptedPreference(context: Context, key: String, fallback: String): String {
    val stored = prefs(context).getString(key, null) ?: return fallback
    if (!FinanceSmsCrypto.isEncryptedPayload(stored)) {
      writeEncryptedPreference(context, key, stored)
      return stored
    }
    return runCatching { FinanceSmsCrypto.decrypt(stored) }.getOrElse {
      prefs(context).edit().remove(key).apply()
      fallback
    }
  }

  private fun writeEncryptedPreference(context: Context, key: String, value: String) {
    prefs(context).edit().putString(key, FinanceSmsCrypto.encrypt(value)).apply()
  }

  private fun normalize(value: String) = value.trim().lowercase(Locale.US)

  private fun rememberProcessedId(context: Context, id: String) {
    val processedIds = processedMessageIds(context).toMutableList()
    processedIds.remove(id)
    processedIds.add(id)
    while (processedIds.size > MAX_PROCESSED_MESSAGE_IDS) {
      processedIds.removeAt(0)
    }
    writeEncryptedPreference(context, KEY_PROCESSED_MESSAGE_IDS, JSONArray(processedIds).toString())
  }

  private fun processedMessageIds(context: Context): Set<String> {
    val preferences = prefs(context)
    val legacyIds = runCatching {
      preferences.getStringSet(KEY_PROCESSED_MESSAGE_IDS, null)?.toSet()
    }.getOrNull()
    if (legacyIds != null) {
      preferences.edit().remove(KEY_PROCESSED_MESSAGE_IDS).commit()
      writeEncryptedPreference(context, KEY_PROCESSED_MESSAGE_IDS, JSONArray(legacyIds.toList()).toString())
      return legacyIds
    }

    val payload = readEncryptedPreference(context, KEY_PROCESSED_MESSAGE_IDS, "[]")
    val parsed = JSONArray(payload)
    return buildSet {
      for (index in 0 until parsed.length()) {
        parsed.optString(index).takeIf { it.isNotBlank() }?.let(::add)
      }
    }
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
