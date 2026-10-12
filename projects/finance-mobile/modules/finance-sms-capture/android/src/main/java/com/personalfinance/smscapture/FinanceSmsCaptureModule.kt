package com.personalfinance.smscapture

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import java.util.concurrent.TimeUnit
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FinanceSmsCaptureModule : Module() {
  private var connectivity: ConnectivityManager? = null
  private var networkCallback: ConnectivityManager.NetworkCallback? = null
  @Volatile private var validatedNetwork: Network? = null

  override fun definition() = ModuleDefinition {
    Name("FinanceSmsCapture")

    OnCreate {
      val context = appContext.reactContext
      if (context != null) {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() {
          override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            val usable = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
              capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            if (usable && validatedNetwork != network) {
              validatedNetwork = network
              recoverConnectedSync(context)
            } else if (!usable && validatedNetwork == network) validatedNetwork = null
          }
          override fun onLost(network: Network) {
            if (validatedNetwork == network) validatedNetwork = null
          }
        }
        manager.registerDefaultNetworkCallback(callback)
        connectivity = manager
        networkCallback = callback
      }
    }
    OnDestroy {
      networkCallback?.let { callback -> runCatching { connectivity?.unregisterNetworkCallback(callback) } }
      networkCallback = null
      connectivity = null
      validatedNetwork = null
    }

    AsyncFunction("getPermissionStatusAsync") {
      mapOf(
        "canReadSms" to hasPermission(Manifest.permission.READ_SMS),
        "canReceiveSms" to hasPermission(Manifest.permission.RECEIVE_SMS)
      )
    }

    AsyncFunction("configureSenderRulesAsync") { rules: List<Map<String, Any?>> ->
      val parsedRules = rules.map { rule ->
        FinanceSmsStore.SenderRule(
          id = rule["id"]?.toString().orEmpty(),
          matchType = rule["matchType"]?.toString().orEmpty(),
          sender = rule["sender"]?.toString().orEmpty(),
          pattern = rule["pattern"]?.toString().orEmpty(),
          isActive = rule["isActive"] as? Boolean ?: true
        )
      }
      FinanceSmsStore.configureRules(requireContext(), parsedRules)
      mapOf("configuredCount" to parsedRules.count { it.sender.isNotBlank() })
    }

    AsyncFunction("getCapturedMessagesAsync") { limit: Int? ->
      FinanceSmsStore.getMessages(requireContext(), limit ?: 50)
    }

    AsyncFunction("listInboxSendersAsync") { limit: Int? ->
      if (!hasPermission(Manifest.permission.READ_SMS)) {
        throw IllegalStateException("Android SMS read permission is required before loading sender names.")
      }
      FinanceSmsStore.listInboxSenders(requireContext(), limit ?: 5000)
    }

    AsyncFunction("scanHistoricalMessagesAsync") { options: Map<String, Any?>? ->
      if (!hasPermission(Manifest.permission.READ_SMS)) {
        throw IllegalStateException("Android SMS read permission is required before scanning message history.")
      }
      val limit = (options?.get("limit") as? Number)?.toInt() ?: 500
      val fromTimestamp = (options?.get("fromTimestamp") as? Number)?.toLong()
      val toTimestamp = (options?.get("toTimestamp") as? Number)?.toLong()
      val includeProcessed = options?.get("includeProcessed") as? Boolean ?: false
      FinanceSmsStore.scanHistoricalMessages(
        requireContext(),
        limit,
        fromTimestamp,
        toTimestamp,
        includeProcessed
      )
    }

    AsyncFunction("clearCapturedMessagesAsync") { ids: List<String> ->
      FinanceSmsStore.clearMessages(requireContext(), ids)
    }

    AsyncFunction("resetTrackingStateAsync") {
      FinanceSmsStore.resetTrackingState(requireContext())
    }

    AsyncFunction("getSecureRawQueueAsync") {
      FinanceSmsStore.getSecureRawQueue(requireContext())
    }

    AsyncFunction("setSecureRawQueueAsync") { value: String ->
      FinanceSmsStore.setSecureRawQueue(requireContext(), value)
      if (FinanceSmsStore.getSyncSession(requireContext()) != null) {
        FinanceSmsSyncWorker.enqueue(requireContext()).get(15, TimeUnit.SECONDS)
      }
    }

    AsyncFunction("configureBackgroundSyncAsync") { apiBaseUrl: String, accessToken: String, refreshToken: String, username: String ->
      FinanceSmsStore.configureSyncSession(
        requireContext(),
        apiBaseUrl,
        accessToken,
        refreshToken,
        username
      )
      FinanceSmsSyncWorker.enqueue(requireContext(), SmsSyncTrigger.RECOVERY).get(15, TimeUnit.SECONDS)
    }

    AsyncFunction("clearBackgroundSyncSessionAsync") {
      FinanceSmsStore.clearSyncSession(requireContext())
    }

    AsyncFunction("enqueueBackgroundSyncAsync") {
      FinanceSmsStore.retryRejected(requireContext())
      FinanceSmsSyncWorker.enqueue(requireContext(), SmsSyncTrigger.MANUAL).get(15, TimeUnit.SECONDS)
    }

    AsyncFunction("resumeBackgroundSyncAsync") {
      recoverConnectedSync(requireContext())?.get(15, TimeUnit.SECONDS)
      Unit
    }

    AsyncFunction("getBackgroundSyncStatusAsync") {
      FinanceSmsSyncWorker.status(requireContext())
    }

    AsyncFunction("getBackgroundSyncSessionAsync") {
      FinanceSmsStore.getSyncSession(requireContext())?.let { session ->
        mapOf(
          "access" to session.accessToken,
          "refresh" to session.refreshToken,
          "username" to session.username
        )
      }
    }
  }

  private fun requireContext(): Context {
    return appContext.reactContext ?: throw IllegalStateException("React context is not available.")
  }

  private fun recoverConnectedSync(context: Context): java.util.concurrent.Future<*>? {
    val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    val capabilities = manager.getNetworkCapabilities(manager.activeNetwork)
    if (capabilities?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) != true) return null
    if (FinanceSmsStore.getSyncStatus(context)["failureKind"] == "auth") return null
    return FinanceSmsSyncWorker.enqueue(context, SmsSyncTrigger.RECOVERY)
  }

  private fun hasPermission(permission: String): Boolean {
    return ContextCompat.checkSelfPermission(requireContext(), permission) == PackageManager.PERMISSION_GRANTED
  }
}
