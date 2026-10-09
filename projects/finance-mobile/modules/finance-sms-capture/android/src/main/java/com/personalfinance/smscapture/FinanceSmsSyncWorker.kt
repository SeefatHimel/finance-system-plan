package com.personalfinance.smscapture

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.net.HttpURLConnection
import java.net.URL
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
          else "No SMS messages are waiting to sync.", rejectedCount = pending)
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
              "The saved session expired. Open Finance Mobile and sign in again.", importedCount, rejectedCount)
            return Result.failure()
          }
          response = importMessage(session, message)
        }
        when {
          response.code in 200..299 -> {
            FinanceSmsStore.acknowledgeMessage(applicationContext, message)
            importedCount += 1
          }
          isRetryableSmsResponse(response.code) -> throw IllegalStateException(
            "Finance API returned ${response.code}. Queued SMS will retry automatically.")
          response.code == 401 || response.code == 403 -> {
            FinanceSmsStore.setSyncStatus(applicationContext, "error",
              "SMS upload is not authorized (${response.code}). Open the app and sign in again.", importedCount, rejectedCount)
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
        else "Uploaded $importedCount SMS message(s). $pending waiting.", importedCount, rejectedCount)
      val hasMore = FinanceSmsStore.getMessages(applicationContext, 1, includeRejected = false).isNotEmpty()
      if (hasMore) enqueue(applicationContext)
      return if (rejectedCount > 0 && !hasMore) Result.failure() else Result.success()
    } catch (error: kotlinx.coroutines.CancellationException) {
      throw error
    } catch (error: Exception) {
      FinanceSmsStore.setSyncStatus(applicationContext, "error",
        error.message ?: "Background SMS sync failed and will retry.", importedCount, rejectedCount)
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
      throw IllegalStateException("Session refresh is temporarily unavailable (${response.code}); SMS will retry.")
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

    fun enqueue(context: Context) {
      FinanceSmsStore.migrateRawQueue(context)
      val constraints = Constraints.Builder()
        .setRequiredNetworkType(NetworkType.CONNECTED)
        .build()
      val request = OneTimeWorkRequestBuilder<FinanceSmsSyncWorker>()
        .setConstraints(constraints)
        .build()
      WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
        UNIQUE_WORK_NAME,
        ExistingWorkPolicy.APPEND_OR_REPLACE,
        request
      )
    }
  }
}
