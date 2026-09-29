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

class FinanceSmsSyncWorker(
  appContext: Context,
  workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
  override suspend fun doWork(): Result {
    var session = FinanceSmsStore.getSyncSession(applicationContext) ?: return Result.success()
    val messages = FinanceSmsStore.getMessages(applicationContext, 500)
    if (messages.isEmpty()) {
      FinanceSmsStore.setSyncStatus(applicationContext, "success", "No SMS messages are waiting to sync.")
      return Result.success()
    }

    FinanceSmsStore.setSyncStatus(applicationContext, "running", "Syncing ${messages.size} captured SMS message(s)…")
    val completedIds = mutableListOf<String>()
    var importedCount = 0
    var rejectedCount = 0

    return try {
      for (message in messages) {
        var response = importMessage(session, message)
        if (response.code == HttpURLConnection.HTTP_UNAUTHORIZED) {
          session = refreshSession(session) ?: run {
            FinanceSmsStore.setSyncStatus(
              applicationContext,
              "error",
              "The saved session expired. Open Finance Mobile and sign in again.",
              importedCount,
              rejectedCount
            )
            return Result.failure()
          }
          response = importMessage(session, message)
        }

        when (response.code) {
          in 200..299 -> {
            completedIds.add(message.getValue("id"))
            importedCount += 1
          }
          in 400..499 -> throw RejectedMessageException(response.code)
          else -> throw IllegalStateException("Finance API returned ${response.code}.")
        }
      }

      FinanceSmsStore.clearMessages(applicationContext, completedIds)
      FinanceSmsStore.setSyncStatus(
        applicationContext,
        "success",
        "Background sync imported $importedCount and rejected $rejectedCount message(s).",
        importedCount,
        rejectedCount
      )
      Result.success()
    } catch (error: RejectedMessageException) {
      rejectedCount += 1
      FinanceSmsStore.clearMessages(applicationContext, completedIds)
      FinanceSmsStore.setSyncStatus(
        applicationContext,
        "error",
        "A queued SMS was rejected by the Finance API (${error.statusCode}). It remains encrypted on this device; refresh sender rules, then retry.",
        importedCount,
        rejectedCount
      )
      Result.failure()
    } catch (error: Exception) {
      FinanceSmsStore.clearMessages(applicationContext, completedIds)
      FinanceSmsStore.setSyncStatus(
        applicationContext,
        "error",
        error.message ?: "Background SMS sync failed and will retry.",
        importedCount,
        rejectedCount
      )
      Result.retry()
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
      .put("device_message_id", "native:${message.getValue("id")}")
      .put("reprocess_existing", false)
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
    if (response.code !in 200..299) {
      return null
    }
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
    connection.outputStream.use { stream ->
      stream.write(body.toByteArray(Charsets.UTF_8))
    }
    val code = connection.responseCode
    val responseBody = (if (code in 200..299) connection.inputStream else connection.errorStream)
      ?.bufferedReader()
      ?.use { it.readText() }
      .orEmpty()
    connection.disconnect()
    return HttpResponse(code, responseBody)
  }

  private data class HttpResponse(val code: Int, val body: String)

  private class RejectedMessageException(val statusCode: Int) : Exception()

  companion object {
    private const val UNIQUE_WORK_NAME = "finance-sms-background-sync"

    fun enqueue(context: Context) {
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
