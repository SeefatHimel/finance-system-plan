package com.personalfinance.smscapture

// Command-only Expo functions must not expose coordinator objects or scheduler
// results to JavaScript. Unit is converted to null by Expo's promise bridge.
internal fun smsBridgeCommand(action: () -> Any?): Unit {
  action()
}
