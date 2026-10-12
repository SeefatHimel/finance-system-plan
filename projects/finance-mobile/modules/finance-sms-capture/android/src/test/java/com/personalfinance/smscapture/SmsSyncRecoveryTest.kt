package com.personalfinance.smscapture

import java.net.UnknownHostException
import java.net.SocketTimeoutException
import org.junit.Assert.*
import org.junit.Test

class SmsSyncRecoveryTest {
  @Test fun manualRetryAndReconnectReplaceTheDelayedChain() {
    for (trigger in listOf(SmsSyncTrigger.MANUAL, SmsSyncTrigger.RECOVERY)) {
      assertEquals(SmsWorkPlan.REPLACE, smsWorkPlan(listOf("ENQUEUED", "BLOCKED"), trigger))
    }
  }
  @Test fun capturesDoNotAccumulateJobsBehindBackoff() {
    repeat(20) {
      assertEquals(SmsWorkPlan.KEEP, smsWorkPlan(listOf("ENQUEUED"), SmsSyncTrigger.CAPTURE))
    }
  }
  @Test fun recoveryNeverCancelsAnActiveUploadAndKeepsOneSuccessor() {
    for (trigger in SmsSyncTrigger.values()) {
      assertEquals(SmsWorkPlan.APPEND, smsWorkPlan(listOf("RUNNING"), trigger))
      assertEquals(SmsWorkPlan.KEEP, smsWorkPlan(listOf("RUNNING", "BLOCKED"), trigger))
    }
    assertEquals(SmsWorkPlan.KEEP, smsWorkPlan(emptyList(), SmsSyncTrigger.CAPTURE))
  }
  @Test fun networkFailureDoesNotRequireRejectingOrDroppingMessages() {
    val dns = smsSyncFailure(UnknownHostException("Synthetic server"))
    assertEquals("network", dns.kind)
    assertTrue(dns.message.contains("remain saved"))
    assertEquals("network", smsSyncFailure(SocketTimeoutException()).kind)
    assertEquals("server", smsSyncFailure(SmsRetryableHttpException(503)).kind)
    assertEquals("other", smsSyncFailure(IllegalStateException()).kind)
  }
}
