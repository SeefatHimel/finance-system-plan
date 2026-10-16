package com.personalfinance.smscapture

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class SmsUploadIntegrationTest {
  private class Sessions(var value: SmsSession?) : SmsSessionStore {
    override fun read() = value
    override fun write(session: SmsSession) { value = session }
    override fun clear() { value = null }
  }
  private class Queue(size: Int) : SmsUploadQueue {
    val rows = (0 until size).associate { index ->
      "synthetic-$index" to mapOf("id" to "synthetic-$index", "sender" to "TESTBANK", "body" to "Synthetic message",
        "receivedAt" to "2026-01-01T00:00:00Z", "deviceMessageId" to "synthetic-$index", "reprocessExisting" to "false")
    }.toMutableMap()
    val held = mutableSetOf<String>()
    val delayed = mutableSetOf<String>()
    val counts = mutableListOf<Int>()
    override fun eligible(limit: Int) = rows.values.filter { it["id"] !in held && it["id"] !in delayed }.take(limit)
    override fun acknowledge(message: Map<String, String>) { rows.remove(message.getValue("id")); counts.add(rows.size) }
    override fun reject(id: String, code: Int) { held.add(id) }
    override fun postpone(id: String, code: Int, until: Long) { delayed.add(id) }
    override fun pending() = rows.size
    override fun retryable() = rows.keys.count { it !in held }
  }
  private fun coordinator(store: Sessions, http: SmsTransport) = SmsSessionCoordinator(store, http) { it.startsWith("fresh-") }
  private fun session(server: MockWebServer) = SmsSession(server.url("").toString().trimEnd('/'), "expired-0", "refresh-0", "synthetic-user")

  private fun batchResponse(request: RecordedRequest, codes: Map<String, Int> = emptyMap()): MockResponse {
    assertEquals("/api/messages/import/batch/", request.path)
    val messages = JSONObject(request.body.readUtf8()).getJSONArray("messages")
    assertTrue(messages.length() in 1..25)
    val results = org.json.JSONArray()
    repeat(messages.length()) { index ->
      val id = messages.getJSONObject(index).getString("client_id")
      results.put(JSONObject().put("client_id", id).put("status", codes[id] ?: 201).put("message_id", "saved-$id"))
    }
    return MockResponse().setBody(JSONObject().put("results", results).toString())
  }

  @Test fun all552MessagesUse23BatchRequestsWithValidatedReceipts() {
    val server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest) = batchResponse(request)
    }
    server.start()
    try {
      val store = Sessions(session(server)); val queue = Queue(552); val http = SmsHttpClient()
      val result = SmsUploadEngine(queue, coordinator(store, http), http).drain("synthetic-user")
      assertEquals(552, result.imported); assertEquals(0, queue.pending()); assertFalse(result.retry)
      assertEquals((551 downTo 0).toList(), queue.counts)
      assertEquals(23, server.requestCount)
    } finally { server.shutdown() }
  }

  @Test fun aPoisonFirstMessageDoesNotBlock551LaterMessages() {
    val server = MockWebServer()
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        return batchResponse(request, mapOf("synthetic-0" to 500))
      }
    }
    server.start()
    try {
      val store = Sessions(session(server)); val queue = Queue(552); val http = SmsHttpClient()
      val result = SmsUploadEngine(queue, coordinator(store, http), http).drain("synthetic-user")
      assertEquals(551, result.imported); assertEquals(1, queue.pending()); assertTrue(result.retry)
      assertTrue(queue.rows.containsKey("synthetic-0")); assertTrue(queue.delayed.contains("synthetic-0"))
    } finally { server.shutdown() }
  }

  @Test fun aForegroundRotationDuringTheUploadUsesCurrentTokensInsteadOfBlacklistedRefresh() {
    val server = MockWebServer(); server.start()
    val store = Sessions(session(server)); val http = SmsHttpClient(); val auth = coordinator(store, http)
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        if (request.getHeader("Authorization") == "Bearer expired-0") {
          auth.configure(store.value!!.copy(accessToken = "fresh-1", refreshToken = "refresh-1"), explicitLogin = true)
          return MockResponse().setResponseCode(401).setBody("{}")
        }
        assertEquals("Bearer fresh-1", request.getHeader("Authorization"))
        return MockResponse().setResponseCode(201).setBody("{}")
      }
    }
    try {
      val queue = Queue(2)
      assertEquals(2, SmsUploadEngine(queue, auth, http, batchEnabled = false).drain("synthetic-user").imported)
      assertEquals(0, queue.pending()); assertEquals(3, server.requestCount)
    } finally { server.shutdown() }
  }

  @Test fun foregroundAndWorkerShareOneInFlightRefreshAndStaleConfigureCannotRollItBack() {
    val server = MockWebServer(); server.start()
    val started = CountDownLatch(1); val release = CountDownLatch(1)
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        started.countDown(); assertTrue(release.await(3, TimeUnit.SECONDS))
        return MockResponse().setBody("{\"access\":\"fresh-1\",\"refresh\":\"refresh-1\"}")
      }
    }
    try {
      val original = session(server); val store = Sessions(original); val auth = coordinator(store, SmsHttpClient())
      val foreground = auth.refresh(original.username, original.accessToken)
      assertTrue(started.await(3, TimeUnit.SECONDS))
      val worker = auth.refresh(original.username, original.accessToken)
      assertSame(foreground, worker)
      release.countDown()
      assertEquals("refresh-1", worker.get(3, TimeUnit.SECONDS).refreshToken)
      assertEquals("refresh-1", auth.configure(original).refreshToken)
      assertEquals(1, server.requestCount)
    } finally { release.countDown(); server.shutdown() }
  }

  @Test fun tricklingResponseHasAnOverallDeadlineAndCannotAcknowledgeTheQueue() {
    val server = MockWebServer(); server.start()
    server.enqueue(MockResponse().setBody("x".repeat(80)).throttleBody(1, 50, TimeUnit.MILLISECONDS))
    try {
      val store = Sessions(session(server)); val queue = Queue(3); val http = SmsHttpClient(250)
      val start = System.nanoTime()
      try { SmsUploadEngine(queue, coordinator(store, http), http, batchEnabled = false).drain("synthetic-user"); fail("Deadline should stop a trickling response") }
      catch (error: Exception) { assertEquals("network", smsSyncFailure(error).kind) }
      assertTrue(TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - start) < 2000)
      assertEquals(3, queue.pending()); assertTrue(queue.counts.isEmpty())
    } finally { server.shutdown() }
  }

  @Test fun globalServiceOutageRetainsAllMessagesWithoutHammeringEveryRecord() {
    val server = MockWebServer(); server.start(); server.enqueue(MockResponse().setResponseCode(503))
    try {
      val store = Sessions(session(server)); val queue = Queue(552); val http = SmsHttpClient()
      try { SmsUploadEngine(queue, coordinator(store, http), http, batchEnabled = false).drain("synthetic-user"); fail("Service outage should retry") }
      catch (error: SmsRetryableHttpException) { assertEquals(503, error.code) }
      assertEquals(552, queue.pending()); assertEquals(1, server.requestCount)
    } finally { server.shutdown() }
  }

  @Test fun anExplicitNewLoginWinsEvenIfAnOlderRefreshFails() {
    val server = MockWebServer(); server.start()
    val started = CountDownLatch(1); val release = CountDownLatch(1)
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        started.countDown(); release.await(3, TimeUnit.SECONDS)
        return MockResponse().setResponseCode(401)
      }
    }
    try {
      val original = session(server); val store = Sessions(original); val auth = coordinator(store, SmsHttpClient())
      val old = auth.refresh(original.username, original.accessToken)
      assertTrue(started.await(3, TimeUnit.SECONDS))
      auth.configure(original.copy(accessToken = "fresh-login", refreshToken = "login-refresh"), explicitLogin = true)
      release.countDown()
      assertEquals("login-refresh", old.get(3, TimeUnit.SECONDS).refreshToken)
      assertEquals("login-refresh", store.value!!.refreshToken)
    } finally { release.countDown(); server.shutdown() }
  }

  @Test fun switchingUsersDuringUploadCannotAcknowledgeAnotherQueue() {
    val server = MockWebServer(); server.start()
    val store = Sessions(session(server)); val auth = coordinator(store, SmsHttpClient())
    server.dispatcher = object : Dispatcher() {
      override fun dispatch(request: RecordedRequest): MockResponse {
        auth.configure(store.value!!.copy(username = "different-synthetic-user"), explicitLogin = true)
        return MockResponse().setResponseCode(201)
      }
    }
    try {
      val queue = Queue(2)
      try { SmsUploadEngine(queue, auth, SmsHttpClient(), batchEnabled = false).drain("synthetic-user"); fail("Changed user must stop uploads") }
      catch (_: SmsSessionChanged) { assertEquals(2, queue.pending()); assertTrue(queue.counts.isEmpty()) }
    } finally { server.shutdown() }
  }

  @Test fun rejectedMessagesAreHeldWithoutBlockingValidLaterMessages() {
    val server = MockWebServer(); server.start()
    server.enqueue(MockResponse().setResponseCode(400)); server.enqueue(MockResponse().setResponseCode(201))
    try {
      val store = Sessions(session(server)); val queue = Queue(2); val http = SmsHttpClient()
      val result = SmsUploadEngine(queue, coordinator(store, http), http, batchEnabled = false).drain("synthetic-user")
      assertEquals(1, result.rejected); assertEquals(1, result.imported); assertEquals(1, queue.pending())
      assertFalse(result.retry); assertEquals(setOf("synthetic-0"), queue.held)
    } finally { server.shutdown() }
  }

  @Test fun acknowledgementFailureRetainsTheUnacknowledgedMessageAndIdentifiesItsStage() {
    val server = MockWebServer(); server.start(); server.enqueue(MockResponse().setResponseCode(201))
    try {
      val store = Sessions(session(server)); val queue = Queue(2); val http = SmsHttpClient()
      var stage = ""
      val failed = object : SmsUploadQueue by queue {
        override fun complete(results: List<SmsUploadOutcome>) { throw SmsStorageException(IllegalStateException("Synthetic commit failure")) }
      }
      try { SmsUploadEngine(failed, coordinator(store, http), http, progress = { stage = it.stage }, batchEnabled = false).drain("synthetic-user"); fail("Storage failure should retain the queue") }
      catch (_: SmsStorageException) { assertEquals("acknowledge", stage) }
      assertEquals(2, queue.pending())
    } finally { server.shutdown() }
  }
}
