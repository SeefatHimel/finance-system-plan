package com.personalfinance.smscapture

import android.content.Context
import androidx.work.Constraints
import androidx.work.BackoffPolicy
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import java.util.concurrent.Future
import org.json.JSONObject
import kotlinx.coroutines.ensureActive

class FinanceSmsSyncWorker(
  appContext: Context,
  workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
  override suspend fun doWork(): Result {
    var session = FinanceSmsStore.getSyncSession(applicationContext) ?: return Result.success()
    var importedCount = 0
    var rejectedCount = 0
    try {
      FinanceSmsStore.migrateRawQueue(applicationContext)
      val messages = FinanceSmsStore.getMessages(applicationContext, 1000, includeRejected = false)
      if (messages.isEmpty()) {
        val pending = FinanceSmsStore.pendingMessageCount(applicationContext)
        FinanceSmsStore.setSyncStatus(applicationContext, if (pending > 0) "error" else "success",
          if (pending > 0) "$pending SMS message(s) need attention. Refresh sender rules and retry."
          else "No SMS messages are waiting to sync.", rejectedCount = pending, failureKind = if (pending > 0) "rejected" else "")
        return Result.success()
      }
      FinanceSmsStore.setSyncStatus(applicationContext, "running", "Syncing ${messages.size} queued SMS message(s)…")
      val startedAt = android.os.SystemClock.elapsedRealtime()
      for (message in messages) {
        if (android.os.SystemClock.elapsedRealtime() - startedAt >= 240_000) break
        kotlinx.coroutines.currentCoroutineContext().ensureActive()
        var response = importMessage(session, message)
        if (response.code == HttpURLConnection.HTTP_UNAUTHORIZED) {
          session = refreshSession(session) ?: run {
            FinanceSmsStore.setSyncStatus(applicationContext, "error",
              "The saved session expired. Open Finance Mobile and sign in again.", importedCount, rejectedCount, "auth")
            return Result.failure()
          }
          response = importMessage(session, message)
        }
        when {
          response.code in 200..299 -> {
            FinanceSmsStore.acknowledgeMessage(applicationContext, message)
            importedCount += 1
          }
          isRetryableSmsResponse(response.code) -> throw SmsRetryableHttpException(response.code)
          response.code == 401 || response.code == 403 -> {
            FinanceSmsStore.setSyncStatus(applicationContext, "error",
              "SMS upload is not authorized (${response.code}). Open the app and sign in again.", importedCount, rejectedCount, "auth")
            return Result.failure()
          }
          response.code in 400..499 -> {
            FinanceSmsStore.markRejected(applicationContext, message.getValue("id"))
            rejectedCount += 1
          }
          else -> throw IllegalStateException("Finance API returned ${response.code}.")
        }
        val pending = FinanceSmsStore.pendingMessageCount(applicationContext)
        FinanceSmsStore.setSyncStatus(applicationContext, "running",
          "Uploaded $importedCount; $pending waiting; $rejectedCount need attention.", importedCount, rejectedCount)
      }
      val pending = FinanceSmsStore.pendingMessageCount(applicationContext)
      FinanceSmsStore.setSyncStatus(applicationContext, if (rejectedCount > 0) "error" else "success",
        if (rejectedCount > 0) "Uploaded $importedCount. $rejectedCount SMS were rejected and remain encrypted; refresh sender rules and retry. $pending waiting."
        else "Uploaded $importedCount SMS message(s). $pending waiting.", importedCount, rejectedCount, if (rejectedCount > 0) "rejected" else "")
      val hasMore = FinanceSmsStore.getMessages(applicationContext, 1, includeRejected = false).isNotEmpty()
      if (hasMore) enqueue(applicationContext, SmsSyncTrigger.CONTINUATION).get(15, TimeUnit.SECONDS)
      return if (rejectedCount > 0 && !hasMore) Result.failure() else Result.success()
    } catch (error: kotlinx.coroutines.CancellationException) {
      throw error
    } catch (error: Exception) {
      val failure = smsSyncFailure(error)
      FinanceSmsStore.setSyncStatus(applicationContext, "error",
        failure.message, importedCount, rejectedCount, failure.kind)
      return Result.retry()
    }
  }

  private fun importMessage(
    session: FinanceSmsStore.SyncSession,
    message: Map<String, String>
  ): HttpResponse {
    val payload = JSONObject()
      .put("sender", message.getValue("sender"))
      .put("body", message.getValue("body"))
      .put("received_at", message.getValue("receivedAt"))
      .put("device_message_id", message.getValue("deviceMessageId"))
      .put("reprocess_existing", message.getValue("reprocessExisting").toBoolean())
    return request(
      url = "${session.apiBaseUrl}/api/messages/import/",
      body = payload.toString(),
      authorization = "Bearer ${session.accessToken}"
    )
  }

  private fun refreshSession(session: FinanceSmsStore.SyncSession): FinanceSmsStore.SyncSession? {
    val payload = JSONObject().put("refresh", session.refreshToken)
    val response = request(
      url = "${session.apiBaseUrl}/api/auth/refresh/",
      body = payload.toString()
    )
    if (isRetryableSmsResponse(response.code)) {
      throw SmsRetryableHttpException(response.code)
    }
    if (response.code !in 200..299) return null
    val parsed = JSONObject(response.body)
    val accessToken = parsed.optString("access")
    val refreshToken = parsed.optString("refresh", session.refreshToken)
    if (accessToken.isBlank()) {
      return null
    }
    FinanceSmsStore.configureSyncSession(
      applicationContext,
      session.apiBaseUrl,
      accessToken,
      refreshToken,
      session.username
    )
    return FinanceSmsStore.SyncSession(session.apiBaseUrl, accessToken, refreshToken, session.username)
  }

  private fun request(url: String, body: String, authorization: String? = null): HttpResponse {
    val connection = (URL(url).openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 15_000
      readTimeout = 20_000
      doOutput = true
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("Accept", "application/json")
      if (authorization != null) {
        setRequestProperty("Authorization", authorization)
      }
    }
    try {
      connection.outputStream.use { stream ->
        stream.write(body.toByteArray(Charsets.UTF_8))
      }
      val code = connection.responseCode
      val responseBody = (if (code in 200..299) connection.inputStream else connection.errorStream)
        ?.bufferedReader()
        ?.use { it.readText() }
        .orEmpty()
      return HttpResponse(code, responseBody)
    } finally {
      connection.disconnect()
    }
  }

  private data class HttpResponse(val code: Int, val body: String)

  companion object {
    private const val UNIQUE_WORK_NAME = "finance-sms-background-sync"
    private val scheduler = Executors.newSingleThreadExecutor()

    internal fun enqueue(context: Context, trigger: SmsSyncTrigger = SmsSyncTrigger.CAPTURE,
      onComplete: () -> Unit = {}): Future<*> = scheduler.submit {
      try {
        enqueueNow(context.applicationContext, trigger)
      } catch (error: Exception) {
        FinanceSmsStore.setSyncStatus(context, "error", "Could not schedule saved SMS. Reopen the app or retry.", failureKind = "other")
        throw error
      } finally {
        onComplete()
      }
    }

    private fun enqueueNow(context: Context, trigger: SmsSyncTrigger) {
      FinanceSmsStore.migrateRawQueue(context)
      if (FinanceSmsStore.getSyncSession(context) == null ||
        FinanceSmsStore.getMessages(context, 1, includeRejected = false).isEmpty()) return
      val manager = WorkManager.getInstance(context.applicationContext)
      val unfinished = manager.getWorkInfosForUniqueWork(UNIQUE_WORK_NAME).get(5, TimeUnit.SECONDS)
        .filter { !it.state.isFinished }
      val plan = smsWorkPlan(unfinished.map { it.state.name }, trigger)
      val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
      val request = OneTimeWorkRequestBuilder<FinanceSmsSyncWorker>()
        .setConstraints(constraints)
        .setBackoffCriteria(BackoffPolicy.LINEAR, 30, TimeUnit.SECONDS)
        .build()
      manager.enqueueUniqueWork(
        UNIQUE_WORK_NAME,
        when (plan) {
          SmsWorkPlan.KEEP -> ExistingWorkPolicy.KEEP
          SmsWorkPlan.APPEND -> ExistingWorkPolicy.APPEND_OR_REPLACE
          SmsWorkPlan.REPLACE -> ExistingWorkPolicy.REPLACE
        },
        request
      ).result.get(5, TimeUnit.SECONDS)
    }

    internal fun status(context: Context): Map<String, Any> {
      val stored = FinanceSmsStore.getSyncStatus(context).toMutableMap()
      val work = runCatching {
        WorkManager.getInstance(context.applicationContext).getWorkInfosForUniqueWork(UNIQUE_WORK_NAME)
          .get(5, TimeUnit.SECONDS).filter { !it.state.isFinished }
      }.getOrDefault(emptyList())
      val running = work.any { it.state.name == "RUNNING" }
      val next = work.filter { it.state.name == "ENQUEUED" }.minOfOrNull { it.nextScheduleTimeMillis }
      stored["workerRunning"] = running
      stored["retryScheduled"] = work.isNotEmpty()
      stored["retryAttempt"] = work.maxOfOrNull { it.runAttemptCount } ?: 0
      stored["nextAttemptAt"] = if (next != null && next > 0 && next < Long.MAX_VALUE)
        java.time.Instant.ofEpochMilli(next).toString() else ""
      if (!running && stored["state"] == "running") {
        stored["state"] = "idle"
        stored["message"] = if (work.isNotEmpty()) "SMS are saved. Waiting for connectivity or Android scheduling."
          else "SMS sync paused. Retry to resume saved messages."
      }
      return stored
    }
  }
}
