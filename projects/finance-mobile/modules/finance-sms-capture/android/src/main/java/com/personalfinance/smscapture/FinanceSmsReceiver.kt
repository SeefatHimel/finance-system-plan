package com.personalfinance.smscapture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class FinanceSmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) {
      return
    }

    val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
    if (messages.isEmpty()) {
      return
    }

    val sender = messages.firstOrNull()?.originatingAddress ?: return
    val body = messages.joinToString(separator = "") { it.messageBody.orEmpty() }
    val receivedAt = messages
      .map { it.timestampMillis }
      .filter { it > 0L }
      .minOrNull() ?: System.currentTimeMillis()

    FinanceSmsStore.appendIfTracked(context.applicationContext, sender, body, receivedAt)
  }
}
