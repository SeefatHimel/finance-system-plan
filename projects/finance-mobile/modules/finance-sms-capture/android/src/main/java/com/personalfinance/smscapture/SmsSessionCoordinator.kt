package com.personalfinance.smscapture

import org.json.JSONObject
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Executors

data class SmsSession(val apiBaseUrl: String, val accessToken: String, val refreshToken: String, val username: String)
internal class SmsSessionExpired : Exception()
internal class SmsSessionChanged : Exception()
internal interface SmsSessionStore {
  fun read(): SmsSession?
  fun write(session: SmsSession)
  fun clear()
}

/** Native uploads and foreground APIs use one rotation owner and one refresh flight. */
internal class SmsSessionCoordinator(
  private val store: SmsSessionStore,
  private val transport: SmsTransport,
  private val fresh: (String) -> Boolean,
) {
  private val lock = Any()
  private val executor = Executors.newSingleThreadExecutor { task -> Thread(task, "sms-session-refresh").apply { isDaemon = true } }
  private var flight: CompletableFuture<SmsSession>? = null
  private var flightOwner: String? = null

  fun configure(incoming: SmsSession, explicitLogin: Boolean = false): SmsSession = synchronized(lock) {
    val current = store.read()
    if (!explicitLogin && current != null && current.username != incoming.username) throw SmsSessionChanged()
    // React may still hold credentials that the worker has already rotated.
    if (!explicitLogin && current != null && current.username == incoming.username && current.apiBaseUrl == incoming.apiBaseUrl) current
    else { store.write(incoming); incoming }
  }

  fun current(owner: String): SmsSession = synchronized(lock) {
    store.read()?.takeIf { it.username == owner } ?: throw SmsSessionChanged()
  }

  fun clear() = synchronized(lock) { store.clear() }

  fun refresh(owner: String, rejectedAccess: String): CompletableFuture<SmsSession> = synchronized(lock) {
    val before = current(owner)
    val scope = "$owner@${before.apiBaseUrl}"
    if (before.accessToken != rejectedAccess && fresh(before.accessToken)) return@synchronized CompletableFuture.completedFuture(before)
    if (flightOwner == scope && flight != null && !flight!!.isDone) return@synchronized flight!!
    val result = CompletableFuture<SmsSession>()
    flight = result; flightOwner = scope
    executor.execute {
      try {
        val response = transport.post("${before.apiBaseUrl}/api/auth/refresh/", JSONObject().put("refresh", before.refreshToken).toString())
        if (response.code == 401 || response.code == 403) throw SmsSessionExpired()
        if (response.code !in 200..299) throw SmsRetryableHttpException(response.code)
        val payload = JSONObject(response.body)
        val updated = before.copy(accessToken = payload.getString("access"), refreshToken = payload.optString("refresh", before.refreshToken))
        require(updated.accessToken.isNotBlank() && updated.refreshToken.isNotBlank())
        val winner = synchronized(lock) {
          val current = current(owner)
          if (current.refreshToken == before.refreshToken && current.apiBaseUrl == before.apiBaseUrl) { store.write(updated); updated }
          else current // A fresh explicit login wins over an older in-flight rotation.
        }
        result.complete(winner)
      } catch (error: Exception) {
        val replacement = runCatching { synchronized(lock) {
          store.read()?.takeIf { it.username == owner && it.refreshToken != before.refreshToken && fresh(it.accessToken) }
        } }.getOrNull()
        if (replacement != null) result.complete(replacement) else result.completeExceptionally(error)
      }
      finally { synchronized(lock) { if (flight === result) { flight = null; flightOwner = null } } }
    }
    result
  }
}
