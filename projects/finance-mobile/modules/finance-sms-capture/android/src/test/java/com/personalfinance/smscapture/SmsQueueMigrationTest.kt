package com.personalfinance.smscapture

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SmsQueueMigrationTest {
  private fun legacy(id: String, deviceId: String = "native:$id", reprocess: Boolean = false) = JSONObject()
    .put("id", "app-$id").put("deviceMessageId", deviceId)
    .put("sender", "TESTBANK").put("body", "Synthetic test message")
    .put("receivedAt", "2026-01-01T00:00:00Z").put("reprocessExisting", reprocess)

  @Test fun migratesAll440RecordsWithoutChangingImportIdentities() {
    val queue = JSONArray()
    repeat(440) { queue.put(legacy("test-$it")) }
    val result = mergeSmsQueues(JSONArray(), queue)
    assertEquals(440, result.length())
    repeat(440) {
      assertEquals("test-$it", result.getJSONObject(it).getString("id"))
      assertEquals("native:test-$it", result.getJSONObject(it).getString("deviceMessageId"))
    }
  }

  @Test fun repeatedMigrationDoesNotDuplicateRecords() {
    val queue = JSONArray().put(legacy("one"))
    val once = mergeSmsQueues(JSONArray(), queue)
    assertEquals(1, mergeSmsQueues(once, queue).length())
  }

  @Test fun duplicateCapturePreservesReprocessingIntentAndReleasesRejectionHold() {
    val captured = JSONArray().put(JSONObject().put("id", "one").put("rejected", true))
    val result = mergeSmsQueues(captured, JSONArray().put(legacy("one", reprocess = true)))
    assertEquals(1, result.length())
    assertTrue(result.getJSONObject(0).getBoolean("reprocessExisting"))
    assertFalse(result.getJSONObject(0).optBoolean("rejected"))
    assertFalse(captured.getJSONObject(0).optBoolean("reprocessExisting"))
  }

  @Test fun keepsManualDeviceIdsAndEmptyIdsForBackendBodyDeduplication() {
    val result = mergeSmsQueues(JSONArray(), JSONArray()
      .put(legacy("one", "manual-test-id")).put(legacy("two", "")))
    assertEquals("legacy:app-one", result.getJSONObject(0).getString("id"))
    assertEquals("manual-test-id", result.getJSONObject(0).getString("deviceMessageId"))
    assertEquals("", result.getJSONObject(1).getString("deviceMessageId"))
  }

  @Test fun malformedLegacyDataCannotProduceAPartiallyMigratedQueue() {
    val captured = JSONArray().put(JSONObject().put("id", "existing"))
    try {
      mergeSmsQueues(captured, JSONArray().put(legacy("good")).put(JSONObject().put("id", "broken")))
      fail("Invalid records must leave the original queue intact")
    } catch (_: org.json.JSONException) {
      assertEquals(1, captured.length())
    }
  }

  @Test fun retryableResponsesAreDistinctFromRecordsNeedingCorrection() {
    for (code in listOf(408, 429, 500, 502, 503, 504)) assertTrue(isRetryableSmsResponse(code))
    for (code in listOf(200, 201, 400, 401, 403, 404, 422)) assertFalse(isRetryableSmsResponse(code))
  }
}
