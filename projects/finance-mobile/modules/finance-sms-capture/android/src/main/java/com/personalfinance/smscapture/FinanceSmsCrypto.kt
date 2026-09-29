package com.personalfinance.smscapture

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object FinanceSmsCrypto {
  private const val PAYLOAD_PREFIX = "enc:v1:"
  private const val KEY_ALIAS = "finance_sms_capture_aes_v1"
  private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
  private const val TRANSFORMATION = "AES/GCM/NoPadding"

  fun encrypt(value: String): String {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    val payload = ByteArray(cipher.iv.size + encrypted.size)
    cipher.iv.copyInto(payload)
    encrypted.copyInto(payload, cipher.iv.size)
    return PAYLOAD_PREFIX + Base64.encodeToString(payload, Base64.NO_WRAP)
  }

  fun decrypt(value: String): String {
    if (value.isBlank()) {
      return ""
    }
    require(isEncryptedPayload(value)) { "SMS payload is not encrypted." }
    val payload = Base64.decode(value.removePrefix(PAYLOAD_PREFIX), Base64.NO_WRAP)
    require(payload.size > 12) { "Encrypted SMS payload is invalid." }
    val iv = payload.copyOfRange(0, 12)
    val encrypted = payload.copyOfRange(12, payload.size)
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
    return String(cipher.doFinal(encrypted), Charsets.UTF_8)
  }

  fun isEncryptedPayload(value: String): Boolean = value.startsWith(PAYLOAD_PREFIX)

  @Synchronized
  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER).run {
      init(
        KeyGenParameterSpec.Builder(
          KEY_ALIAS,
          KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setRandomizedEncryptionRequired(true)
          .build()
      )
      generateKey()
    }
  }
}
