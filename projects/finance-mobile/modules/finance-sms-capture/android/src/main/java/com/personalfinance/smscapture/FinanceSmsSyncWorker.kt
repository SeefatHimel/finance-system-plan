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
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import java.util.concurrent.Future

class FinanceSmsSyncWorker(
  appContext: Context,
  workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {
  private val uploads = SmsHttpClient(deadlineMs = 60_000, readTimeoutMs = 60_000)

  override suspend fun doWork(): Result {
    var latest = SmsUploadProgress("session", 0, 0)
    var lastStatusAt = 0L
    try {
      val session = FinanceSmsStore.getSyncSession(applicationContext) ?: throw SmsSessionExpired()
      latest = latest.copy(stage = "migration")
      FinanceSmsStore.migrateRawQueue(applicationContext)
      val queue = object : SmsUploadQueue {
        override fun eligible(limit: Int) = FinanceSmsStore.getMessages(applicationContext, limit, includeRejected = false)
        override fun acknowledge(message: Map<String, String>) = FinanceSmsStore.acknowledgeMessage(applicationContext, message, session.username)
        override fun reject(id: String, code: Int) = FinanceSmsStore.markRejected(applicationContext, id, code)
        override fun postpone(id: String, code: Int, until: Long) = FinanceSmsStore.postponeMessage(applicationContext, id, code, until)
        override fun pending() = FinanceSmsStore.pendingMessageCount(applicationContext)
        override fun retryable() = FinanceSmsStore.retryableMessageCount(applicationContext)
        override fun complete(results: List<SmsUploadOutcome>) =
          FinanceSmsStore.completeUploadBatch(applicationContext, results, session.username, session.apiBaseUrl)
      }
      val engine = SmsUploadEngine(queue, FinanceSmsAuth.sessions(applicationContext), uploads,
        active = { if (isStopped) throw kotlinx.coroutines.CancellationException("SMS worker stopped") },
        progress = { progress ->
          latest = progress
          val time = android.os.SystemClock.elapsedRealtime()
          if (progress.stage == "progress" || progress.stage == "auth_refresh" || time - lastStatusAt >= 1000) {
            val pending = queue.pending()
            FinanceSmsStore.setSyncStatus(applicationContext, "running",
              "Uploaded ${progress.imported}; $pending saved on device.", progress.imported, progress.rejected,
              stage = progress.stage, httpCode = progress.httpCode, pendingCount = pending)
            lastStatusAt = time
          }
        })
      val result = kotlinx.coroutines.runInterruptible(kotlinx.coroutines.Dispatchers.IO) { engine.drain(session.username) }
      val pending = queue.pending()
      FinanceSmsStore.setSyncStatus(applicationContext,
        if (result.retry || result.rejected > 0) "error" else "success",
        "Uploaded ${result.imported}; $pending saved on device. " +
          if (result.retry) "Remaining messages will retry; temporary per-message errors do not block later messages."
          else if (pending > 0) "Remaining messages need correction." else "Queue is empty.",
        result.imported, result.rejected,
        if (result.retry) "server" else if (pending > 0) "rejected" else "", "complete", latest.httpCode)
      if (queue.eligible(1).isNotEmpty()) {
        enqueue(applicationContext, SmsSyncTrigger.CONTINUATION).get(15, TimeUnit.SECONDS)
        return Result.success()
      }
      return if (result.retry) Result.retry() else if (pending > 0) Result.failure() else Result.success()
    } catch (error: kotlinx.coroutines.CancellationException) {
      throw error
    } catch (error: Exception) {
      val failure = smsSyncFailure(error)
      FinanceSmsStore.setSyncStatus(applicationContext, "error", failure.message,
        latest.imported, latest.rejected, failure.kind, latest.stage, latest.httpCode, error.javaClass.simpleName)
      return if (error is SmsSessionExpired || error is SmsSessionChanged || error is SmsStorageException)
        Result.failure() else Result.retry()
    }
  }

  companion object {
    private const val UNIQUE_WORK_NAME = "finance-sms-background-sync"
    private val scheduler = Executors.newSingleThreadExecutor()

    internal fun cancel(context: Context) {
      WorkManager.getInstance(context.applicationContext).cancelUniqueWork(UNIQUE_WORK_NAME)
    }

    internal fun enqueue(context: Context, trigger: SmsSyncTrigger = SmsSyncTrigger.CAPTURE,
      onComplete: () -> Unit = {}): Future<*> = scheduler.submit {
      try {
        enqueueNow(context.applicationContext, trigger)
      } catch (error: Exception) {
        val failure = smsSyncFailure(error)
        FinanceSmsStore.setSyncStatus(context, "error", failure.message, failureKind = failure.kind,
          stage = "scheduling", errorClass = error.javaClass.simpleName)
        throw error
      } finally {
        onComplete()
      }
    }

    private fun enqueueNow(context: Context, trigger: SmsSyncTrigger) {
      FinanceSmsStore.migrateRawQueue(context)
      if (FinanceSmsStore.getSyncSession(context) == null ||
        FinanceSmsStore.retryableMessageCount(context) == 0) return
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
      stored["configuredHost"] = runCatching { java.net.URI(FinanceSmsStore.getSyncSession(context)?.apiBaseUrl ?: "").host ?: "" }.getOrDefault("")
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
