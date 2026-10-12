package com.personalfinance.smscapture

import android.content.Context
import android.util.Base64
import org.json.JSONObject

internal object FinanceSmsAuth {
  private var coordinator: SmsSessionCoordinator? = null

  @Synchronized fun sessions(context: Context): SmsSessionCoordinator {
    return coordinator ?: SmsSessionCoordinator(object : SmsSessionStore {
      override fun read() = FinanceSmsStore.getSyncSession(context.applicationContext)
      override fun write(session: SmsSession) {
        FinanceSmsStore.configureSyncSession(context.applicationContext, session.apiBaseUrl, session.accessToken, session.refreshToken, session.username)
      }
      override fun clear() { FinanceSmsStore.clearSyncSession(context.applicationContext) }
    }, SmsHttpClient(), ::fresh).also { coordinator = it }
  }

  private fun fresh(token: String): Boolean = runCatching {
    val payload = String(Base64.decode(token.split('.')[1], Base64.URL_SAFE or Base64.NO_WRAP), Charsets.UTF_8)
    JSONObject(payload).getLong("exp") * 1000 > System.currentTimeMillis() + 30_000
  }.getOrDefault(false)
}
