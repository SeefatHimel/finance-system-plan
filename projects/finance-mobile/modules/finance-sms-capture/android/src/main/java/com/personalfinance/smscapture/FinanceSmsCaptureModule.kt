package com.personalfinance.smscapture

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class FinanceSmsCaptureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FinanceSmsCapture")

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
          sender = rule["sender"]?.toString().orEmpty()
        )
      }
      FinanceSmsStore.configureRules(requireContext(), parsedRules)
      mapOf("configuredCount" to parsedRules.count { it.sender.isNotBlank() })
    }

    AsyncFunction("getCapturedMessagesAsync") { limit: Int? ->
      FinanceSmsStore.getMessages(requireContext(), limit ?: 50)
    }

    AsyncFunction("scanHistoricalMessagesAsync") { limit: Int? ->
      if (!hasPermission(Manifest.permission.READ_SMS)) {
        throw IllegalStateException("Android SMS read permission is required before scanning message history.")
      }
      FinanceSmsStore.scanHistoricalMessages(requireContext(), limit ?: 500)
    }

    AsyncFunction("clearCapturedMessagesAsync") { ids: List<String> ->
      FinanceSmsStore.clearMessages(requireContext(), ids)
    }
  }

  private fun requireContext(): Context {
    return appContext.reactContext ?: throw IllegalStateException("React context is not available.")
  }

  private fun hasPermission(permission: String): Boolean {
    return ContextCompat.checkSelfPermission(requireContext(), permission) == PackageManager.PERMISSION_GRANTED
  }
}
