package com.personalfinance.smscapture

import java.net.ConnectException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

internal enum class SmsSyncTrigger { CAPTURE, RECOVERY, MANUAL, CONTINUATION }
internal enum class SmsWorkPlan { KEEP, APPEND, REPLACE }

/** Coalesce ordinary requests; a recovery request must not sit behind backoff. */
internal fun smsWorkPlan(states: List<String>, trigger: SmsSyncTrigger): SmsWorkPlan {
  if (states.contains("RUNNING")) {
    return if (states.any { it == "ENQUEUED" || it == "BLOCKED" }) SmsWorkPlan.KEEP
      else SmsWorkPlan.APPEND
  }
  return if (states.isNotEmpty() && trigger in listOf(SmsSyncTrigger.MANUAL, SmsSyncTrigger.RECOVERY))
    SmsWorkPlan.REPLACE else SmsWorkPlan.KEEP
}

internal class SmsRetryableHttpException(val code: Int) : Exception()
internal data class SmsSyncFailure(val kind: String, val message: String)

internal fun smsSyncFailure(error: Exception): SmsSyncFailure = when (error) {
  is UnknownHostException -> SmsSyncFailure("network",
    "Could not resolve the finance server. SMS remain saved on this device. Try switching Wi-Fi/mobile data or checking Private DNS; upload will retry automatically.")
  is SocketTimeoutException -> SmsSyncFailure("network",
    "The finance server did not respond in time. SMS remain saved and will retry automatically.")
  is ConnectException, is SocketException -> SmsSyncFailure("network",
    "Connection interrupted. SMS remain saved and will retry when connectivity returns.")
  is SmsRetryableHttpException -> SmsSyncFailure("server",
    "Finance service is temporarily unavailable (${error.code}). SMS remain saved and will retry automatically.")
  else -> SmsSyncFailure("other", "SMS sync could not finish. Saved messages are retained; retry or reopen the app.")
}
