package com.personalfinance.smscapture

import expo.modules.kotlin.types.JSTypeConverter
import org.junit.Assert.*
import org.junit.Test

class SmsBridgeCommandTest {
  @Test fun loginPersistsTheSessionWithoutReturningItsNativeObjectOrCredentials() {
    var saved: SmsSession? = null
    val store = object : SmsSessionStore {
      override fun read() = saved
      override fun write(session: SmsSession) { saved = session }
      override fun clear() { saved = null }
    }
    val coordinator = SmsSessionCoordinator(store, SmsHttpClient()) { true }
    val incoming = SmsSession("https://example.invalid", "synthetic-access", "synthetic-refresh", "synthetic-user")
    val result = smsBridgeCommand { coordinator.configure(incoming, explicitLogin = true) }
    assertEquals(incoming, saved)
    assertNull(JSTypeConverter.convertToJSValue(result))
    assertNull(JSTypeConverter.legacyConvertToJSValue(result))
  }

  @Test fun schedulerReturnValuesAreDiscardedAfterTheCommandCompletes() {
    var completed = false
    val result = smsBridgeCommand {
      completed = true
      java.util.concurrent.CompletableFuture.completedFuture(Any()).get()
    }
    assertTrue(completed)
    assertNull(JSTypeConverter.convertToJSValue(result))
  }

  @Test fun storageFailuresStillRejectInitialization() {
    val failure = SmsStorageException(IllegalStateException("Synthetic storage failure"))
    try {
      smsBridgeCommand { throw failure }
      fail("An unsaved session must not report successful initialization")
    } catch (actual: SmsStorageException) {
      assertSame(failure, actual)
    }
  }
}
