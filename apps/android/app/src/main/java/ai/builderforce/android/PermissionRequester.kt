package ai.builderforce.android

import android.content.pm.PackageManager
import android.content.Intent
import android.Manifest
import android.net.Uri
import android.provider.Settings
import androidx.appcompat.app.AlertDialog
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.app.ActivityCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

class PermissionRequester(private val activity: ComponentActivity) {
  private val mutex = Mutex()
  private var pending: CompletableDeferred<Map<String, Boolean>>? = null

  private val launcher: ActivityResultLauncher<Array<String>> =
    activity.registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
      val p = pending
      pending = null
      p?.complete(result)
    }

  suspend fun requestIfMissing(
    permissions: List<String>,
    timeoutMs: Long = 20_000,
  ): Map<String, Boolean> =
    mutex.withLock {
      val missing =
        permissions.filter { perm ->
          ContextCompat.checkSelfPermission(activity, perm) != PackageManager.PERMISSION_GRANTED
        }
      if (missing.isEmpty()) {
        return permissions.associateWith { true }
      }

      val needsRationale =
        missing.any { ActivityCompat.shouldShowRequestPermissionRationale(activity, it) }
      if (needsRationale) {
        val proceed = showRationaleDialog(missing)
        if (!proceed) {
          return permissions.associateWith { perm ->
            ContextCompat.checkSelfPermission(activity, perm) == PackageManager.PERMISSION_GRANTED
          }
        }
      }

      val deferred = CompletableDeferred<Map<String, Boolean>>()
      pending = deferred
      withContext(Dispatchers.Main) {
        launcher.launch(missing.toTypedArray())
      }

      val result =
        withContext(Dispatchers.Default) {
          kotlinx.coroutines.withTimeout(timeoutMs) { deferred.await() }
        }

      // Merge: if something was already granted, treat it as granted even if launcher omitted it.
      val merged =
        permissions.associateWith { perm ->
        val nowGranted =
          ContextCompat.checkSelfPermission(activity, perm) == PackageManager.PERMISSION_GRANTED
        result[perm] == true || nowGranted
      }

      val denied =
        merged.filterValues { !it }.keys.filter {
          !ActivityCompat.shouldShowRequestPermissionRationale(activity, it)
        }
      if (denied.isNotEmpty()) {
        showSettingsDialog(denied)
      }

      return merged
    }

  private suspend fun showRationaleDialog(permissions: List<String>): Boolean =
    withContext(Dispatchers.Main) {
      suspendCancellableCoroutine { cont ->
        AlertDialog.Builder(activity)
          .setTitle(R.string.permission_required_title)
          .setMessage(buildRationaleMessage(permissions))
          .setPositiveButton(R.string.action_continue) { _, _ -> cont.resume(true) }
          .setNegativeButton(R.string.action_not_now) { _, _ -> cont.resume(false) }
          .setOnCancelListener { cont.resume(false) }
          .show()
      }
    }

  private fun showSettingsDialog(permissions: List<String>) {
    AlertDialog.Builder(activity)
      .setTitle(R.string.permission_settings_title)
      .setMessage(buildSettingsMessage(permissions))
      .setPositiveButton(R.string.action_open_settings) { _, _ ->
        val intent =
          Intent(
            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", activity.packageName, null),
          )
        activity.startActivity(intent)
      }
      .setNegativeButton(R.string.action_cancel, null)
      .show()
  }

  private fun buildRationaleMessage(permissions: List<String>): String {
    val labels = permissions.map { permissionLabel(it) }
    return activity.getString(R.string.permission_rationale, labels.joinToString(", "))
  }

  private fun buildSettingsMessage(permissions: List<String>): String {
    val labels = permissions.map { permissionLabel(it) }
    return activity.getString(R.string.permission_settings_message, labels.joinToString(", "))
  }

  private fun permissionLabel(permission: String): String =
    when (permission) {
      Manifest.permission.CAMERA -> activity.getString(R.string.permission_label_camera)
      Manifest.permission.RECORD_AUDIO -> activity.getString(R.string.permission_label_microphone)
      Manifest.permission.SEND_SMS -> activity.getString(R.string.permission_label_sms)
      else -> permission
    }
}
