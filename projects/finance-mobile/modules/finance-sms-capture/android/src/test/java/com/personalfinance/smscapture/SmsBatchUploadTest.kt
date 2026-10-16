package com.personalfinance.smscapture

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.SocketTimeoutException

class SmsBatchUploadTest {
  private class Store(var session: SmsSession? = SmsSession("https://api.example.invalid", "expired-0", "refresh-0", "demo")) : SmsSessionStore {
    override fun read() = session
    override fun write(session: SmsSession) { this.session = session }
    override fun clear() { session = null }
  }
  private class Queue(size: Int) : SmsUploadQueue {
    var rows = JSONArray().apply { repeat(size) { index -> put(JSONObject()
      .put("id", "demo-$index").put("deviceMessageId", "native:demo-$index")
      .put("sender", "TESTBANK").put("body", "Synthetic BDT 100 payment")
      .put("receivedAt", "2026-01-01T00:00:00Z").put("reprocessExisting", false).put("restoreRedacted", false)) } }
    var commits = 0
    var failCommit = false
    override fun eligible(limit: Int) = (0 until rows.length()).map { rows.getJSONObject(it) }
      .filter { !it.optBoolean("rejected") && it.optLong("retryAt") <= 1000 }
      .take(limit).map { item -> item.keys().asSequence().associateWith { item.get(it).toString() } }
    override fun acknowledge(message: Map<String, String>) = complete(listOf(SmsUploadOutcome(message, 201)))
    override fun reject(id: String, code: Int) { error("Use atomic batch completion") }
    override fun postpone(id: String, code: Int, until: Long) { error("Use atomic batch completion") }
    override fun pending() = rows.length()
    override fun retryable() = (0 until rows.length()).count { !rows.getJSONObject(it).optBoolean("rejected") }
    override fun complete(results: List<SmsUploadOutcome>) {
      val replacement = applySmsUploadReceipts(rows, results)
      if (failCommit) throw SmsStorageException(IllegalStateException("Synthetic storage failure"))
      rows = replacement
      commits++
    }
  }
  private class Http(val respond: (String, String, String?) -> SmsHttpResponse) : SmsTransport {
    val calls = mutableListOf<Pair<String, String>>()
    override fun post(url: String, body: String, accessToken: String?): SmsHttpResponse {
      calls.add(url to body)
      return respond(url, body, accessToken)
    }
  }
  private fun reply(body: String, codes: Map<String, Int> = emptyMap()): SmsHttpResponse {
    val messages = JSONObject(body).getJSONArray("messages")
    val results = JSONArray()
    repeat(messages.length()) { index ->
      val id = messages.getJSONObject(index).getString("client_id")
      results.put(JSONObject().put("client_id", id).put("status", codes[id] ?: 201).put("message_id", "saved:$id"))
    }
    return SmsHttpResponse(200, JSONObject().put("results", results).toString())
  }
  private fun engine(queue: Queue, store: Store, http: Http, progress: (SmsUploadProgress) -> Unit = {}) =
    SmsUploadEngine(queue, SmsSessionCoordinator(store, http) { it.startsWith("fresh-") }, http,
      now = { 1000 }, progress = progress)

  @Test fun completes100MessagesInFourRequestsAndFourDurableWrites() {
    val queue = Queue(100); val http = Http { _, body, _ -> reply(body) }
    assertEquals(100, engine(queue, Store(), http).drain("demo").imported)
    assertEquals(4, http.calls.size); assertEquals(4, queue.commits); assertEquals(0, queue.pending())
  }

  @Test fun mixedResultsAcknowledgeSuccessHoldInvalidAndDelayOnlyRetryableItems() {
    val queue = Queue(6)
    val http = Http { _, body, _ -> reply(body, mapOf("demo-1" to 200, "demo-2" to 400,
      "demo-3" to 500, "demo-4" to 429, "demo-5" to 503)) }
    val result = engine(queue, Store(), http).drain("demo")
    assertEquals(2, result.imported); assertEquals(1, result.rejected); assertTrue(result.retry)
    assertEquals(4, queue.pending()); assertEquals(1, queue.commits)
    assertTrue(queue.rows.getJSONObject(0).getBoolean("rejected"))
    for (index in 1..3) assertEquals(31000, queue.rows.getJSONObject(index).getLong("retryAt"))
  }

  @Test fun lostResponseReplaysIdenticalIdsWithoutDroppingOrDuplicatingAcceptedMessages() {
    val queue = Queue(3); val accepted = mutableSetOf<String>(); var loseResponse = true
    val http = Http { _, body, _ ->
      val items = JSONObject(body).getJSONArray("messages")
      repeat(items.length()) { accepted.add(items.getJSONObject(it).getString("device_message_id")) }
      if (loseResponse) { loseResponse = false; throw SocketTimeoutException("Synthetic lost response") }
      reply(body, mapOf("demo-0" to 200, "demo-1" to 200, "demo-2" to 200))
    }
    try { engine(queue, Store(), http).drain("demo"); fail() } catch (_: SocketTimeoutException) { }
    assertEquals(3, queue.pending()); assertEquals(0, queue.commits)
    assertEquals(3, engine(queue, Store(), http).drain("demo").imported)
    assertEquals(0, queue.pending()); assertEquals(3, accepted.size)
    assertEquals(http.calls[0].second, http.calls[1].second)
  }

  @Test fun missingDuplicateUnknownAndUnconfirmedReceiptsRetainTheEntireBatch() {
    val invalid = listOf("{}", "{\"results\":[]}",
      "{\"results\":[{\"client_id\":\"demo-0\",\"status\":201,\"message_id\":\"saved\"},{\"client_id\":\"demo-0\",\"status\":201,\"message_id\":\"saved\"}]}",
      "{\"results\":[{\"client_id\":\"unknown\",\"status\":201},{\"client_id\":\"demo-1\",\"status\":201}]}",
      "{\"results\":[{\"client_id\":\"demo-0\",\"status\":202},{\"client_id\":\"demo-1\",\"status\":201}]}",
      "{\"results\":[{\"client_id\":\"demo-0\",\"status\":201},{\"client_id\":\"demo-1\",\"status\":201}]}")
    for (body in invalid) {
      val queue = Queue(2); val http = Http { _, _, _ -> SmsHttpResponse(200, body) }
      try { engine(queue, Store(), http).drain("demo"); fail("Invalid receipt must not acknowledge") }
      catch (_: SmsBatchProtocolException) { }
      assertEquals(2, queue.pending()); assertEquals(0, queue.commits)
    }
  }

  @Test fun unsupportedBatchRouteFallsBackWithoutChangingFlagsOrDeviceIds() {
    for (unsupported in listOf(404, 405)) {
      val queue = Queue(2); queue.rows.getJSONObject(0).put("reprocessExisting", true).put("restoreRedacted", true)
      val http = Http { url, body, _ ->
        if (url.endsWith("/batch/")) SmsHttpResponse(unsupported, "") else {
          val item = JSONObject(body)
          if (item.getString("device_message_id") == "native:demo-0") {
            assertTrue(item.getBoolean("reprocess_existing")); assertTrue(item.getBoolean("restore_redacted"))
          }
          SmsHttpResponse(201, "{}")
        }
      }
      assertEquals(2, engine(queue, Store(), http).drain("demo").imported)
      assertEquals(3, http.calls.size); assertEquals(0, queue.pending())
    }
  }

  @Test fun unavailableServiceAndMissingSingleImportRouteCannotRejectTheQueue() {
    for (code in listOf(400, 429, 500, 503)) {
      val queue = Queue(25); val http = Http { _, _, _ -> SmsHttpResponse(code, "") }
      try { engine(queue, Store(), http).drain("demo"); fail() } catch (_: SmsRetryableHttpException) { }
      assertEquals(25, queue.pending()); assertEquals(0, queue.commits); assertEquals(1, http.calls.size)
    }
    val queue = Queue(2); val http = Http { _, _, _ -> SmsHttpResponse(404, "") }
    try { engine(queue, Store(), http).drain("demo"); fail() } catch (_: SmsRetryableHttpException) { }
    assertEquals(0, queue.commits); assertEquals(2, queue.pending())
  }

  @Test fun refreshResendsTheSameBatchWithOneRotatedToken() {
    val queue = Queue(2); val store = Store()
    val http = Http { url, body, token -> when {
      url.endsWith("/refresh/") -> SmsHttpResponse(200, "{\"access\":\"fresh-1\",\"refresh\":\"refresh-1\"}")
      token == "expired-0" -> SmsHttpResponse(401, "")
      else -> { assertEquals("fresh-1", token); reply(body) }
    } }
    assertEquals(2, engine(queue, store, http).drain("demo").imported)
    assertEquals(3, http.calls.size); assertEquals(http.calls[0].second, http.calls[2].second)
    assertEquals("refresh-1", store.session!!.refreshToken)
  }

  @Test fun userOrBackendSwitchDuringARequestCannotAcknowledgeTheOldBatch() {
    for (switchUser in listOf(true, false)) {
      val queue = Queue(2); val store = Store()
      val http = Http { _, body, _ ->
        store.session = if (switchUser) store.session!!.copy(username = "another-demo")
          else store.session!!.copy(apiBaseUrl = "https://another.example.invalid")
        reply(body)
      }
      try { engine(queue, store, http).drain("demo"); fail() } catch (_: SmsSessionChanged) { }
      assertEquals(2, queue.pending()); assertEquals(0, queue.commits)
    }
  }

  @Test fun commitFailureRetainsAllMessagesAndReportsTheAcknowledgementStage() {
    val queue = Queue(25); queue.failCommit = true; var stage = ""
    val http = Http { _, body, _ -> reply(body) }
    try { engine(queue, Store(), http) { stage = it.stage }.drain("demo"); fail() }
    catch (_: SmsStorageException) { }
    assertEquals("acknowledge", stage); assertEquals(25, queue.pending()); assertEquals(0, queue.commits)
  }

  @Test fun newerRestorationRequestAndNewArrivalsSurviveAnOlderSuccessfulReceipt() {
    val queue = Queue(1)
    val http = Http { _, body, _ ->
      queue.rows.getJSONObject(0).put("reprocessExisting", true).put("restoreRedacted", true)
      queue.rows.put(JSONObject(queue.rows.getJSONObject(0).toString()).put("id", "new-arrival"))
      reply(body)
    }
    engine(queue, Store(), http).drain("demo")
    assertEquals(2, queue.pending()); assertTrue(queue.rows.getJSONObject(0).getBoolean("restoreRedacted"))
  }

  @Test fun unicodePayloadsAreBoundedByBytesAsWellAsMessageCount() {
    val queue = Queue(6)
    repeat(6) { queue.rows.getJSONObject(it).put("body", "🙂".repeat(8000)) }
    val http = Http { _, body, _ ->
      assertTrue(body.toByteArray(Charsets.UTF_8).size <= 128 * 1024)
      reply(body)
    }
    assertEquals(6, engine(queue, Store(), http).drain("demo").imported)
    assertEquals(2, http.calls.size)
  }

  @Test fun gatewayPayloadLimitsShrinkTheBatchInsteadOfDroppingItsMessages() {
    val queue = Queue(5)
    val http = Http { _, body, _ ->
      if (JSONObject(body).getJSONArray("messages").length() > 2) SmsHttpResponse(413, "") else reply(body)
    }
    assertEquals(5, engine(queue, Store(), http).drain("demo").imported)
    assertEquals(4, http.calls.size); assertEquals(0, queue.pending())
  }

  @Test fun receiptsMayArriveInADifferentOrderWithoutAcknowledgingTheWrongMessage() {
    val queue = Queue(3)
    val http = Http { _, body, _ ->
      val results = JSONObject(reply(body).body).getJSONArray("results")
      val reordered = JSONArray()
      for (index in results.length() - 1 downTo 0) reordered.put(results.getJSONObject(index))
      SmsHttpResponse(200, JSONObject().put("results", reordered).toString())
    }
    assertEquals(3, engine(queue, Store(), http).drain("demo").imported)
    assertEquals(0, queue.pending())
  }

  @Test fun oversizedSingleMessageIsRetainedForCorrectionWithoutBlockingLaterMessages() {
    val queue = Queue(3)
    queue.rows.getJSONObject(0).put("body", "x".repeat(140000))
    val http = Http { _, body, _ ->
      assertTrue(body.toByteArray(Charsets.UTF_8).size <= 128 * 1024)
      reply(body)
    }
    val result = engine(queue, Store(), http).drain("demo")
    assertEquals(2, result.imported); assertEquals(1, result.rejected)
    assertEquals(1, queue.pending()); assertEquals(1, http.calls.size)
    assertTrue(queue.rows.getJSONObject(0).getBoolean("rejected"))
  }

  @Test fun acceptedButUnconfirmedHttpEnvelopeCannotAcknowledgeMessages() {
    val queue = Queue(2)
    val http = Http { _, body, _ -> reply(body).copy(code = 202) }
    try { engine(queue, Store(), http).drain("demo"); fail() } catch (_: SmsBatchProtocolException) { }
    assertEquals(2, queue.pending()); assertEquals(0, queue.commits)
  }
}
