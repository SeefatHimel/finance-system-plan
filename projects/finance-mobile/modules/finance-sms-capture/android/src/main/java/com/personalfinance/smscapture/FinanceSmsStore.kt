package com.personalfinance.smscapture

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.UUID

object FinanceSmsStore {
  private const val PREFS_NAME = "finance_sms_capture"
  private const val KEY_MESSAGES = "captured_messages"
  private const val KEY_RULES = "sender_rules"

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

  fun appendIfTracked(context: Context, sender: String, body: String, receivedAtMillis: Long) {
    if (sender.isBlank() || body.isBlank() || !matchesEnabledRule(context, sender)) {
      return
    }

    val receivedAt = isoFromMillis(receivedAtMillis)
    val messages = JSONArray(prefs(context).getString(KEY_MESSAGES, "[]"))
    val dedupeKey = "${normalize(sender)}:$receivedAt:${body.trim()}"

    for (index in 0 until messages.length()) {
      val current = messages.optJSONObject(index) ?: continue
      val currentKey = "${normalize(current.optString("sender"))}:${current.optString("receivedAt")}:${current.optString("body").trim()}"
      if (currentKey == dedupeKey) {
        return
      }
    }

    messages.put(
      JSONObject()
        .put("id", UUID.randomUUID().toString())
        .put("sender", sender)
        .put("body", body)
        .put("receivedAt", receivedAt)
    )
    prefs(context).edit().putString(KEY_MESSAGES, messages.toString()).apply()
  }

  fun getMessages(context: Context, limit: Int): List<Map<String, String>> {
    val messages = JSONArray(prefs(context).getString(KEY_MESSAGES, "[]"))
    val boundedLimit = limit.coerceIn(1, 200)
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

  private fun isoFromMillis(value: Long): String {
    return java.time.Instant.ofEpochMilli(value).toString()
  }
}
