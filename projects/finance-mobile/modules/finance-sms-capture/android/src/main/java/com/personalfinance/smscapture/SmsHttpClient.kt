package com.personalfinance.smscapture

import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

internal data class SmsHttpResponse(val code: Int, val body: String)
internal interface SmsTransport {
  fun post(url: String, body: String, accessToken: String? = null): SmsHttpResponse
}

/** A deadline covers DNS, connect, request and the entire response body. */
internal class SmsHttpClient(private val deadlineMs: Long = 25_000, readTimeoutMs: Long = 20_000) : SmsTransport {
  private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(readTimeoutMs, TimeUnit.MILLISECONDS).callTimeout(deadlineMs, TimeUnit.MILLISECONDS)
    .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false).build()
  private val active = ConcurrentHashMap.newKeySet<Call>()

  override fun post(url: String, body: String, accessToken: String?): SmsHttpResponse {
    val request = Request.Builder().url(url).header("Accept", "application/json")
      .post(body.toRequestBody("application/json".toMediaType()))
    if (accessToken != null) request.header("Authorization", "Bearer $accessToken")
    val call = client.newCall(request.build())
    val response = CompletableFuture<SmsHttpResponse>()
    active.add(call)
    call.enqueue(object : Callback {
      override fun onFailure(call: Call, error: IOException) { response.completeExceptionally(error) }
      override fun onResponse(call: Call, result: Response) {
        result.use {
          try { response.complete(SmsHttpResponse(it.code, it.body?.string().orEmpty())) }
          catch (error: Exception) { response.completeExceptionally(error) }
        }
      }
    })
    try {
      return response.get(deadlineMs, TimeUnit.MILLISECONDS)
    } catch (error: TimeoutException) {
      throw SocketTimeoutException("SMS request exceeded its total deadline.")
    } catch (error: java.util.concurrent.ExecutionException) {
      throw (error.cause as? Exception ?: error)
    } finally {
      response.cancel(false)
      active.remove(call)
      call.cancel()
    }
  }

  fun cancelAll() { active.forEach { it.cancel() } }
}
