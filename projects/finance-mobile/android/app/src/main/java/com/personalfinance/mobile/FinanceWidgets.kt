package com.personalfinance.mobile

import android.app.Activity
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.speech.RecognizerIntent
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import org.json.JSONArray
import org.json.JSONObject

private const val PREFS = "finance_home_widgets"
private const val SNAPSHOT = "snapshot"
private const val PRIVACY = "privacy"
private const val MAX_AGE_MS = 24L * 60L * 60L * 1000L

private fun componentFor(context: Context, kind: String): ComponentName = ComponentName(context, when (kind) {
  "quick_add" -> QuickAddWidget::class.java
  "review" -> ReviewWidget::class.java
  "balances" -> BalancesWidget::class.java
  "activity" -> ActivityWidget::class.java
  "spending" -> SpendingWidget::class.java
  else -> PresetsWidget::class.java
})

private fun launch(context: Context, action: String): PendingIntent {
  // Unique data URIs keep each widget button's action independent.
  val uri = Uri.parse("finance://widget/$action")
  val intent = Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
  return PendingIntent.getActivity(
    context, uri.toString().hashCode(), intent,
    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
  )
}

private fun snapshot(context: Context): JSONObject? {
  val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(SNAPSHOT, null) ?: return null
  return try {
    val data = JSONObject(saved)
    val time = data.optLong("syncedAt")
    if (time <= 0 || System.currentTimeMillis() - time > MAX_AGE_MS) null else data
  } catch (_: Exception) { null }
}

private fun privacy(context: Context, owner: String?): JSONObject? {
  if (owner.isNullOrBlank()) return null
  val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(PRIVACY, null) ?: return null
  return try { JSONObject(saved).takeIf { it.optString("owner") == owner } } catch (_: Exception) { null }
}

private fun row(views: RemoteViews, id: Int, label: String?, action: String?, context: Context) {
  views.setViewVisibility(id, if (label.isNullOrBlank()) View.GONE else View.VISIBLE)
  if (!label.isNullOrBlank()) {
    views.setTextViewText(id, label)
    if (action != null) views.setOnClickPendingIntent(id, launch(context, action))
  }
}

private fun item(items: JSONArray?, index: Int) = items?.optJSONObject(index)

private fun render(context: Context, manager: AppWidgetManager, ids: IntArray, kind: String) {
  val data = snapshot(context)
  for (id in ids) {
    val v = RemoteViews(context.packageName, R.layout.finance_widget)
    val signedIn = data?.optBoolean("signedIn") == true
    val allowed = privacy(context, data?.optString("owner"))
    val updated = data?.optLong("syncedAt", 0L) ?: 0L
    val footer = if (signedIn && updated > 0L)
      "Updated ${SimpleDateFormat("d MMM, h:mm a", Locale.getDefault()).format(Date(updated))}  ›"
    else "Open Finance  ›"
    var title = "Finance"
    var subtitle = ""
    var first: String? = null
    var second: String? = null
    var third: String? = null
    var firstAction = "home"
    var secondAction = "home"
    var thirdAction = "home"
    var footerAction = "home"
    when (kind) {
      "quick_add" -> {
        title = "Quick Add"
        subtitle = "Choose an action. Review before saving."
        first = "−  Expense"; firstAction = "expense"
        second = "↔  Transfer"; secondAction = "transfer"
        third = "◉  Voice entry"; thirdAction = "voice"
      }
      "review" -> {
        title = "Review Inbox"
        subtitle = if (signedIn) "${data?.optInt("reviewCount", 0)} waiting for review" else "Sign in to see your review queue"
        first = if (signedIn) "Open review queue  ›" else "Open Finance  ›"
        firstAction = if (signedIn) "review" else "home"
        footerAction = "review"
      }
      "balances" -> {
        title = "Account Balances"
        subtitle = if (signedIn) "Saved account snapshot" else "Sign in to see accounts"
        val accounts = data?.optJSONArray("accounts")
        if (signedIn && allowed?.optBoolean("showBalances") == true && data.optBoolean("showBalances")) {
          first = item(accounts, 0)?.let { "${it.optString("name")}  ·  ${it.optString("balance")}" }
          second = item(accounts, 1)?.let { "${it.optString("name")}  ·  ${it.optString("balance")}" }
          third = item(accounts, 2)?.let { "${it.optString("name")}  ·  ${it.optString("balance")}" }
        } else if (signedIn) first = "Balances hidden · change in Widgets settings"
        firstAction = "accounts"; secondAction = "accounts"; thirdAction = "accounts"; footerAction = "accounts"
      }
      "activity" -> {
        title = "Recent Activity"
        subtitle = if (signedIn) "Latest loaded ledger entries" else "Sign in to see activity"
        val activity = data?.optJSONArray("activity")
        if (signedIn && allowed?.optBoolean("showActivity") == true && data.optBoolean("showActivity")) {
          first = item(activity, 0)?.let { "${it.optString("title")}  ·  ${it.optString("amount")}" }
          second = item(activity, 1)?.let { "${it.optString("title")}  ·  ${it.optString("amount")}" }
          third = item(activity, 2)?.let { "${it.optString("title")}  ·  ${it.optString("amount")}" }
        } else if (signedIn) first = "Activity hidden · change in Widgets settings"
        firstAction = "activity"; secondAction = "activity"; thirdAction = "activity"; footerAction = "activity"
      }
      "spending" -> {
        title = "Spending Snapshot"
        subtitle = if (signedIn) "BDT · ${data.optString("spendingMonth", "This month")}" else "Sign in to see spending"
        if (signedIn && allowed?.optBoolean("showSpending") == true && data.optBoolean("showSpending")) {
          val spending = data.optJSONObject("spending")
          first = if (spending != null) "Spent  ·  ${spending.optString("total")}" else "Open Finance to refresh spending"
          second = spending?.optString("topCategory")?.takeIf { it.isNotBlank() }?.let { "Top category  ·  $it" }
        } else if (signedIn) first = "Spending hidden · change in Widgets settings"
        firstAction = "activity"; secondAction = "activity"; footerAction = "activity"
      }
      "presets" -> {
        title = "Quick Presets"
        subtitle = "Saved shortcuts · review before saving"
        val presets = data?.optJSONArray("presets")
        first = item(presets, 0)?.let { "+  ${it.optString("name")}" }
        second = item(presets, 1)?.let { "+  ${it.optString("name")}" }
        third = item(presets, 2)?.let { "+  ${it.optString("name")}" }
        if (first == null) first = "Open Quick Add to make a preset"
        firstAction = item(presets, 0)?.optString("id")?.takeIf { it.isNotBlank() }?.let { "preset/$it" } ?: "quick_add"
        secondAction = item(presets, 1)?.optString("id")?.takeIf { it.isNotBlank() }?.let { "preset/$it" } ?: "quick_add"
        thirdAction = item(presets, 2)?.optString("id")?.takeIf { it.isNotBlank() }?.let { "preset/$it" } ?: "quick_add"
        footerAction = "quick_add"
      }
    }
    v.setTextViewText(R.id.widget_title, title)
    v.setTextViewText(R.id.widget_subtitle, subtitle)
    row(v, R.id.widget_row_one, first, firstAction, context)
    row(v, R.id.widget_row_two, second, secondAction, context)
    row(v, R.id.widget_row_three, third, thirdAction, context)
    val height = manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 270)
    if (height < 245) v.setViewVisibility(R.id.widget_row_three, View.GONE)
    if (height < 195) v.setViewVisibility(R.id.widget_row_two, View.GONE)
    if (height < 175) v.setViewVisibility(R.id.widget_subtitle, View.GONE)
    v.setTextViewText(R.id.widget_footer, footer)
    v.setOnClickPendingIntent(R.id.widget_footer, launch(context, footerAction))
    manager.updateAppWidget(id, v)
  }
}

private fun refreshAll(context: Context) {
  val manager = AppWidgetManager.getInstance(context)
  for (kind in listOf("quick_add", "review", "balances", "activity", "spending", "presets")) {
    val ids = manager.getAppWidgetIds(componentFor(context, kind))
    render(context, manager, ids, kind)
  }
}

abstract class FinanceWidgetProvider(private val kind: String) : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    render(context, manager, ids, kind)
  }
  override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, options: android.os.Bundle) {
    render(context, manager, intArrayOf(id), kind)
  }
}
class QuickAddWidget : FinanceWidgetProvider("quick_add")
class ReviewWidget : FinanceWidgetProvider("review")
class BalancesWidget : FinanceWidgetProvider("balances")
class ActivityWidget : FinanceWidgetProvider("activity")
class SpendingWidget : FinanceWidgetProvider("spending")
class PresetsWidget : FinanceWidgetProvider("presets")

class FinanceWidgetsModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {
  private var speechPromise: Promise? = null
  private val speechRequest = 31144
  private val speechListener: ActivityEventListener = object : BaseActivityEventListener() {
    override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
      if (requestCode != speechRequest) return
      val pending = speechPromise ?: return
      speechPromise = null
      if (resultCode == Activity.RESULT_OK) {
        val phrase = data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (phrase.isNullOrBlank()) pending.reject("NO_SPEECH", "No speech was recognized.")
        else pending.resolve(phrase)
      } else pending.reject("CANCELLED", "Voice input was cancelled.")
    }
  }

  init { reactContext.addActivityEventListener(speechListener) }
  override fun getName() = "FinanceWidgets"

  @ReactMethod fun syncSnapshot(json: String, promise: Promise) {
    try {
      val data = JSONObject(json)
      if (data.toString().length > 32_000) throw IllegalArgumentException("Widget snapshot is too large.")
      if (!reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(SNAPSHOT, data.toString()).commit())
        throw IllegalStateException("Widget snapshot could not be saved.")
      refreshAll(reactContext)
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("INVALID_SNAPSHOT", e) }
  }

  @ReactMethod fun clearSnapshot(promise: Promise) {
    try {
      if (!reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(SNAPSHOT).commit())
        throw IllegalStateException("Widget snapshot could not be cleared.")
      refreshAll(reactContext)
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("CLEAR_FAILED", e) }
  }

  @ReactMethod fun getPrivacy(owner: String, promise: Promise) {
    promise.resolve(privacy(reactContext, owner)?.toString())
  }

  @ReactMethod fun setPrivacy(owner: String, json: String, promise: Promise) {
    try {
      if (owner.isBlank()) throw IllegalArgumentException("Sign in before changing widget privacy.")
      val requested = JSONObject(json)
      val safe = JSONObject().put("owner", owner)
        .put("showBalances", requested.optBoolean("showBalances", false))
        .put("showActivity", requested.optBoolean("showActivity", false))
        .put("showSpending", requested.optBoolean("showSpending", false))
      if (!reactContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(PRIVACY, safe.toString()).commit())
        throw IllegalStateException("Widget privacy could not be saved.")
      refreshAll(reactContext)
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("PRIVACY_SAVE_FAILED", e) }
  }

  @ReactMethod fun pinWidget(kind: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || kind !in listOf("quick_add", "review", "balances", "activity", "spending", "presets")) {
      promise.resolve(false); return
    }
    val manager = AppWidgetManager.getInstance(reactContext)
    promise.resolve(manager.isRequestPinAppWidgetSupported &&
      manager.requestPinAppWidget(componentFor(reactContext, kind), null, null))
  }

  @ReactMethod fun installedWidgets(promise: Promise) {
    val manager = AppWidgetManager.getInstance(reactContext)
    val result = com.facebook.react.bridge.Arguments.createMap()
    for (kind in listOf("quick_add", "review", "balances", "activity", "spending", "presets"))
      result.putInt(kind, manager.getAppWidgetIds(componentFor(reactContext, kind)).size)
    promise.resolve(result)
  }

  @ReactMethod fun recognizeSpeech(promise: Promise) {
    if (speechPromise != null) { promise.reject("BUSY", "Voice input is already open."); return }
    val activity = currentActivity ?: run { promise.reject("NO_ACTIVITY", "Open Finance to use voice entry."); return }
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
      .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      .putExtra(RecognizerIntent.EXTRA_PROMPT, "Describe an entry. You will review it before saving.")
    if (intent.resolveActivity(reactContext.packageManager) == null) {
      promise.reject("UNAVAILABLE", "No speech recognition app is installed."); return
    }
    speechPromise = promise
    try { activity.startActivityForResult(intent, speechRequest) }
    catch (e: Exception) { speechPromise = null; promise.reject("UNAVAILABLE", e) }
  }
}

class FinanceWidgetsPackage : ReactPackage {
  override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> =
    listOf(FinanceWidgetsModule(context))
  override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
