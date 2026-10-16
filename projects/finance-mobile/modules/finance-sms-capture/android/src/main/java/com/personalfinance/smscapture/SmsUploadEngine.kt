package com.personalfinance.smscapture

import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal interface SmsUploadQueue {
  fun eligible(limit: Int): List<Map<String, String>>
  fun acknowledge(message: Map<String, String>)
  fun reject(id: String, code: Int)
  fun postpone(id: String, code: Int, until: Long)
  fun pending(): Int
  fun retryable(): Int
  fun complete(results: List<SmsUploadOutcome>) {
    results.forEach { result ->
      when {
        result.code in 200..299 -> acknowledge(result.message)
        isRetryableSmsResponse(result.code) -> postpone(result.message.getValue("id"), result.code, result.retryAt)
        else -> reject(result.message.getValue("id"), result.code)
      }
    }
  }
}
internal data class SmsUploadOutcome(val message: Map<String, String>, val code: Int, val retryAt: Long = 0)
internal data class SmsUploadProgress(val stage: String, val imported: Int, val rejected: Int, val httpCode: Int = 0)
internal data class SmsUploadResult(val imported: Int, val rejected: Int, val retry: Boolean)
internal class SmsBatchProtocolException : Exception()

/** One bounded batch in flight. Only validated per-message receipts may change the durable queue. */
internal class SmsUploadEngine(
  private val queue: SmsUploadQueue,
  private val sessions: SmsSessionCoordinator,
  private val transport: SmsTransport,
  private val now: () -> Long = System::currentTimeMillis,
  private val active: () -> Unit = {},
  private val progress: (SmsUploadProgress) -> Unit = {},
  private val batchEnabled: Boolean = true,
) {
  fun drain(owner: String, budgetMs: Long = 240_000): SmsUploadResult {
    var imported = 0; var rejected = 0; var failedBatches = 0
    var batching = batchEnabled
    var batchLimit = 25
    val start = System.nanoTime()
    val apiBaseUrl = sessions.current(owner).apiBaseUrl
    val pending = queue.eligible(1000)
    var offset = 0
    while (offset < pending.size) {
      if (TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) >= budgetMs) break
      active()
      val batch = if (batching) boundedBatch(pending.drop(offset), batchLimit) else listOf(pending[offset])
      val path = if (batching) "/api/messages/import/batch/" else "/api/messages/import/"
      val body = if (batching) JSONObject().put("messages", JSONArray(batch.map { payload(it).put("client_id", it.getValue("id")) })).toString()
        else payload(batch.single()).toString()
      if (batching && body.toByteArray(Charsets.UTF_8).size > 128 * 1024) {
        // Retain an oversized single message for correction rather than blocking every later batch.
        active(); checkScope(owner, apiBaseUrl)
        progress(SmsUploadProgress("acknowledge", imported, rejected, 413))
        queue.complete(batch.map { SmsUploadOutcome(it, 413) })
        rejected += batch.size
        offset += batch.size
        progress(SmsUploadProgress("progress", imported, rejected, 413))
        continue
      }
      progress(SmsUploadProgress("import", imported, rejected))
      val response = authorizedPost(owner, apiBaseUrl, path, body) {
        progress(SmsUploadProgress("auth_refresh", imported, rejected, 401))
      }
      active(); checkScope(owner, apiBaseUrl)
      progress(SmsUploadProgress("response", imported, rejected, response.code))
      if (batching && response.code in listOf(404, 405)) {
        // Older servers remain usable during deployment; do not reject an unsupported route's messages.
        batching = false
        continue
      }
      if (batching && response.code == 413 && batch.size > 1) {
        batchLimit = maxOf(1, batch.size / 2)
        continue
      }
      val outcomes = when {
        response.code == 401 || response.code == 403 -> throw SmsSessionExpired()
        response.code == 429 || response.code == 503 -> throw SmsRetryableHttpException(response.code)
        batching && response.code == 200 -> receipts(batch, response.body)
        batching && response.code in 200..299 -> throw SmsBatchProtocolException()
        batching && response.code == 413 && batch.size == 1 -> listOf(SmsUploadOutcome(batch.single(), 413))
        batching -> throw SmsRetryableHttpException(response.code) // No receipts: outcome is uncertain, retain the entire batch.
        response.code in listOf(404, 405) -> throw SmsRetryableHttpException(response.code)
        response.code in listOf(200, 201) || response.code in 400..599 -> listOf(SmsUploadOutcome(batch.single(), response.code, now() + 30_000))
        else -> throw SmsRetryableHttpException(response.code)
      }
      if (outcomes.any { it.code == 401 || it.code == 403 }) throw SmsSessionExpired()
      active(); checkScope(owner, apiBaseUrl)
      progress(SmsUploadProgress("acknowledge", imported, rejected, response.code))
      queue.complete(outcomes)
      val accepted = outcomes.count { it.code in 200..299 }
      imported += accepted
      rejected += outcomes.count { it.code in 400..499 && !isRetryableSmsResponse(it.code) }
      failedBatches = if (accepted > 0 || outcomes.none { isRetryableSmsResponse(it.code) }) 0 else failedBatches + 1
      progress(SmsUploadProgress("progress", imported, rejected, response.code))
      offset += batch.size
      if (failedBatches >= 3 && outcomes.any { isRetryableSmsResponse(it.code) }) throw SmsRetryableHttpException(500)
    }
    return SmsUploadResult(imported, rejected, queue.retryable() > 0)
  }

  private fun checkScope(owner: String, apiBaseUrl: String) {
    if (sessions.current(owner).apiBaseUrl != apiBaseUrl) throw SmsSessionChanged()
  }

  private fun authorizedPost(owner: String, apiBaseUrl: String, path: String, body: String, refreshing: () -> Unit): SmsHttpResponse {
    var session = sessions.current(owner)
    if (session.apiBaseUrl != apiBaseUrl) throw SmsSessionChanged()
    var response = transport.post(session.apiBaseUrl + path, body, session.accessToken)
    if (response.code == 401) {
      val latest = sessions.current(owner)
      if (latest.apiBaseUrl != apiBaseUrl) throw SmsSessionChanged()
      if (latest.accessToken != session.accessToken) {
        session = latest
        response = transport.post(session.apiBaseUrl + path, body, session.accessToken)
      }
      if (response.code == 401) {
        refreshing()
        session = try { sessions.refresh(owner, session.accessToken).get(30, TimeUnit.SECONDS) }
          catch (error: java.util.concurrent.ExecutionException) { throw (error.cause as? Exception ?: error) }
        if (session.apiBaseUrl != apiBaseUrl) throw SmsSessionChanged()
        response = transport.post(session.apiBaseUrl + path, body, session.accessToken)
      }
    }
    return response
  }

  private fun boundedBatch(messages: List<Map<String, String>>, limit: Int): List<Map<String, String>> {
    var bytes = 32
    return messages.take(limit).takeWhile { message ->
      bytes += payload(message).put("client_id", message.getValue("id")).toString().toByteArray(Charsets.UTF_8).size + 1
      bytes <= 128 * 1024
    }.ifEmpty { listOf(messages.first()) }
  }

  private fun receipts(batch: List<Map<String, String>>, body: String): List<SmsUploadOutcome> {
    try {
      val results = JSONObject(body).getJSONArray("results")
      val expected = batch.associateBy { it.getValue("id") }
      if (results.length() != expected.size) throw SmsBatchProtocolException()
      val seen = mutableSetOf<String>()
      return (0 until results.length()).map { index ->
        val result = results.getJSONObject(index)
        val id = result.getString("client_id")
        val message = expected[id] ?: throw SmsBatchProtocolException()
        if (!seen.add(id)) throw SmsBatchProtocolException()
        val number = result.get("status") as? Number ?: throw SmsBatchProtocolException()
        val code = number.toInt()
        if (number.toDouble() != code.toDouble() || code !in listOf(200, 201) && code !in 400..599) throw SmsBatchProtocolException()
        if (code in 200..299 && result.getString("message_id").isBlank()) throw SmsBatchProtocolException()
        SmsUploadOutcome(message, code, now() + 30_000)
      }
    } catch (error: org.json.JSONException) { throw SmsBatchProtocolException() }
  }

  private fun payload(message: Map<String, String>) = JSONObject()
    .put("sender", message.getValue("sender")).put("body", message.getValue("body"))
    .put("received_at", message.getValue("receivedAt")).put("device_message_id", message.getValue("deviceMessageId"))
    .put("reprocess_existing", message.getValue("reprocessExisting").toBoolean())
    .put("restore_redacted", message["restoreRedacted"]?.toBoolean() ?: false)
}
