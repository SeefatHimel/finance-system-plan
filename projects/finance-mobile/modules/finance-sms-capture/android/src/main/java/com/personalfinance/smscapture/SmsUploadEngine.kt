package com.personalfinance.smscapture

import org.json.JSONObject
import java.util.concurrent.TimeUnit

internal interface SmsUploadQueue {
  fun eligible(limit: Int): List<Map<String, String>>
  fun acknowledge(message: Map<String, String>)
  fun reject(id: String, code: Int)
  fun postpone(id: String, code: Int, until: Long)
  fun pending(): Int
  fun retryable(): Int
}
internal data class SmsUploadProgress(val stage: String, val imported: Int, val rejected: Int, val httpCode: Int = 0)
internal data class SmsUploadResult(val imported: Int, val rejected: Int, val retry: Boolean)

/** Injectable production loop, tested with real HTTP and synthetic queue storage. */
internal class SmsUploadEngine(
  private val queue: SmsUploadQueue,
  private val sessions: SmsSessionCoordinator,
  private val transport: SmsTransport,
  private val now: () -> Long = System::currentTimeMillis,
  private val active: () -> Unit = {},
  private val progress: (SmsUploadProgress) -> Unit = {},
) {
  fun drain(owner: String, budgetMs: Long = 240_000): SmsUploadResult {
    var imported = 0; var rejected = 0; var consecutiveServerFailures = 0
    val start = System.nanoTime()
    for (message in queue.eligible(1000)) {
      if (TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) >= budgetMs) break
      active()
      var session = sessions.current(owner)
      progress(SmsUploadProgress("import", imported, rejected))
      var response = upload(session, message)
      if (response.code == 401) {
        // A foreground API may have rotated the token after this request started.
        val latest = sessions.current(owner)
        if (latest.accessToken != session.accessToken) {
          session = latest; response = upload(session, message)
        }
        if (response.code == 401) {
          progress(SmsUploadProgress("auth_refresh", imported, rejected, 401))
          session = try { sessions.refresh(owner, session.accessToken).get(30, TimeUnit.SECONDS) }
            catch (error: java.util.concurrent.ExecutionException) { throw (error.cause as? Exception ?: error) }
          response = upload(session, message)
        }
      }
      active(); sessions.current(owner)
      progress(SmsUploadProgress("response", imported, rejected, response.code))
      when {
        response.code in 200..299 -> {
          progress(SmsUploadProgress("acknowledge", imported, rejected, response.code))
          queue.acknowledge(message); imported++; consecutiveServerFailures = 0
        }
        response.code == 401 || response.code == 403 -> throw SmsSessionExpired()
        response.code == 429 || response.code == 503 -> throw SmsRetryableHttpException(response.code)
        isRetryableSmsResponse(response.code) -> {
          queue.postpone(message.getValue("id"), response.code, now() + 30_000)
          consecutiveServerFailures++
          if (consecutiveServerFailures >= 3) throw SmsRetryableHttpException(response.code)
        }
        response.code in 400..499 -> { queue.reject(message.getValue("id"), response.code); rejected++; consecutiveServerFailures = 0 }
        else -> throw SmsRetryableHttpException(response.code)
      }
      progress(SmsUploadProgress("progress", imported, rejected, response.code))
    }
    return SmsUploadResult(imported, rejected, queue.retryable() > 0)
  }

  private fun upload(session: SmsSession, message: Map<String, String>): SmsHttpResponse {
    val body = JSONObject().put("sender", message.getValue("sender")).put("body", message.getValue("body"))
      .put("received_at", message.getValue("receivedAt")).put("device_message_id", message.getValue("deviceMessageId"))
      .put("reprocess_existing", message.getValue("reprocessExisting").toBoolean()).toString()
    return transport.post("${session.apiBaseUrl}/api/messages/import/", body, session.accessToken)
  }
}
