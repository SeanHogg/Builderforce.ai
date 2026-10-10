package ai.builderforce.android.ui

import android.annotation.SuppressLint
import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.webkit.WebSettings
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ScreenShare
import androidx.compose.material.icons.filled.ChatBubble
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Error
import androidx.compose.material.icons.filled.FiberManualRecord
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material.icons.filled.RecordVoiceOver
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Report
import androidx.compose.material.icons.filled.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.core.content.ContextCompat
import ai.builderforce.android.CameraHudKind
import ai.builderforce.android.GatewayPhase
import ai.builderforce.android.PairingHint
import ai.builderforce.android.R
import ai.builderforce.android.MainViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RootScreen(viewModel: MainViewModel) {
  var sheet by remember { mutableStateOf<Sheet?>(null) }
  val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
  val safeOverlayInsets = WindowInsets.safeDrawing.only(WindowInsetsSides.Top + WindowInsetsSides.Horizontal)
  val context = LocalContext.current
  val serverName by viewModel.serverName.collectAsState()
  val cameraHud by viewModel.cameraHud.collectAsState()
  val cameraFlashToken by viewModel.cameraFlashToken.collectAsState()
  val screenRecordActive by viewModel.screenRecordActive.collectAsState()
  val isForeground by viewModel.isForeground.collectAsState()
  val voiceWakeStatusText by viewModel.voiceWakeStatusText.collectAsState()
  val talkEnabled by viewModel.talkEnabled.collectAsState()
  val talkStatusText by viewModel.talkStatusText.collectAsState()
  val talkIsListening by viewModel.talkIsListening.collectAsState()
  val talkIsSpeaking by viewModel.talkIsSpeaking.collectAsState()
  val seamColorArgb by viewModel.seamColorArgb.collectAsState()
  val seamColor = remember(seamColorArgb) { ComposeColor(seamColorArgb) }
  val audioPermissionLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
      if (granted) viewModel.setTalkEnabled(true)
    }
  val gatewayIndicator by viewModel.gatewayIndicator.collectAsState()
  val errorTint = MaterialTheme.colorScheme.error
  val micPermissionStatus = stringResource(R.string.voice_status_mic_permission)
  val pausedStatus = stringResource(R.string.voice_status_paused)
  val foregroundRequired = stringResource(R.string.activity_foreground_required)
  val repairingTitle = stringResource(R.string.activity_repairing)
  val repairingDesc = stringResource(R.string.activity_repairing_description)
  val approvalPending = stringResource(R.string.activity_approval_pending)
  val recordingScreenTitle = stringResource(R.string.activity_recording_screen)
  val recordingScreenDesc = stringResource(R.string.activity_recording_screen_description)
  val takingPhotoDesc = stringResource(R.string.activity_taking_photo_description)
  val recordingDesc = stringResource(R.string.activity_recording_description)
  val captureFinishedDesc = stringResource(R.string.activity_capture_finished_description)
  val captureFailedDesc = stringResource(R.string.activity_capture_failed_description)
  val micPermissionTitle = stringResource(R.string.activity_mic_permission)
  val micPermissionDesc = stringResource(R.string.activity_mic_permission_description)
  val voiceWakePausedTitle = stringResource(R.string.activity_voice_wake_paused)
  val activity =
    remember(cameraHud, screenRecordActive, isForeground, gatewayIndicator, voiceWakeStatusText, errorTint) {
      // Status pill owns transient activity state so it doesn't overlap the connection indicator.
      if (!isForeground) {
        return@remember StatusActivity(
          title = foregroundRequired,
          icon = Icons.Default.Report,
          contentDescription = foregroundRequired,
        )
      }

      when (gatewayIndicator.pairing) {
        PairingHint.Repairing ->
          return@remember StatusActivity(
            title = repairingTitle,
            icon = Icons.Default.Refresh,
            contentDescription = repairingDesc,
          )
        PairingHint.ApprovalPending ->
          return@remember StatusActivity(
            title = approvalPending,
            icon = Icons.Default.RecordVoiceOver,
            contentDescription = approvalPending,
          )
        null -> Unit
      }
      // Avoid duplicating the primary gateway status ("Connecting…") in the activity slot.

      if (screenRecordActive) {
        return@remember StatusActivity(
          title = recordingScreenTitle,
          icon = Icons.AutoMirrored.Filled.ScreenShare,
          contentDescription = recordingScreenDesc,
          tint = errorTint,
        )
      }

      cameraHud?.let { hud ->
        return@remember when (hud.kind) {
          CameraHudKind.Photo ->
            StatusActivity(
              title = hud.message,
              icon = Icons.Default.PhotoCamera,
              contentDescription = takingPhotoDesc,
            )
          CameraHudKind.Recording ->
            StatusActivity(
              title = hud.message,
              icon = Icons.Default.FiberManualRecord,
              contentDescription = recordingDesc,
              tint = errorTint,
            )
          CameraHudKind.Success ->
            StatusActivity(
              title = hud.message,
              icon = Icons.Default.CheckCircle,
              contentDescription = captureFinishedDesc,
            )
          CameraHudKind.Error ->
            StatusActivity(
              title = hud.message,
              icon = Icons.Default.Error,
              contentDescription = captureFailedDesc,
              tint = errorTint,
            )
        }
      }

      if (voiceWakeStatusText == micPermissionStatus) {
        return@remember StatusActivity(
          title = micPermissionTitle,
          icon = Icons.Default.Error,
          contentDescription = micPermissionDesc,
        )
      }
      if (voiceWakeStatusText == pausedStatus) {
        return@remember StatusActivity(
          title = voiceWakePausedTitle,
          icon = Icons.Default.RecordVoiceOver,
          contentDescription = voiceWakePausedTitle,
        )
      }

      null
    }

  val voiceEnabled =
    ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
      PackageManager.PERMISSION_GRANTED

  Box(modifier = Modifier.fillMaxSize()) {
    CanvasView(viewModel = viewModel, modifier = Modifier.fillMaxSize())
  }

  // Camera flash must be in a Popup to render above the WebView.
  Popup(alignment = Alignment.Center, properties = PopupProperties(focusable = false)) {
    CameraFlashOverlay(token = cameraFlashToken, modifier = Modifier.fillMaxSize())
  }

  // Keep the overlay buttons above the WebView canvas (AndroidView), otherwise they may not receive touches.
  Popup(alignment = Alignment.TopStart, properties = PopupProperties(focusable = false)) {
    StatusPill(
      gateway = if (serverName != null) GatewayPhase.Connected else gatewayIndicator.phase,
      voiceEnabled = voiceEnabled,
      activity = activity,
      onClick = { sheet = Sheet.Settings },
      modifier = Modifier.windowInsetsPadding(safeOverlayInsets).padding(start = 12.dp, top = 12.dp),
    )
  }

  Popup(alignment = Alignment.TopEnd, properties = PopupProperties(focusable = false)) {
    Column(
      modifier = Modifier.windowInsetsPadding(safeOverlayInsets).padding(end = 12.dp, top = 12.dp),
      verticalArrangement = Arrangement.spacedBy(10.dp),
      horizontalAlignment = Alignment.End,
    ) {
      OverlayIconButton(
        onClick = { sheet = Sheet.Chat },
        icon = { Icon(Icons.Default.ChatBubble, contentDescription = stringResource(R.string.overlay_chat)) },
      )

      // Talk mode gets a dedicated side bubble instead of burying it in settings.
      val baseOverlay = overlayContainerColor()
      val talkContainer =
        lerp(
          baseOverlay,
          seamColor.copy(alpha = baseOverlay.alpha),
          if (talkEnabled) 0.35f else 0.22f,
        )
      val talkContent = if (talkEnabled) seamColor else overlayIconColor()
      OverlayIconButton(
        onClick = {
          val next = !talkEnabled
          if (next) {
            val micOk =
              ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
            if (!micOk) audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
            viewModel.setTalkEnabled(true)
          } else {
            viewModel.setTalkEnabled(false)
          }
        },
        containerColor = talkContainer,
        contentColor = talkContent,
        icon = {
          Icon(
            Icons.Default.RecordVoiceOver,
            contentDescription = stringResource(R.string.overlay_talk_mode),
          )
        },
      )

      OverlayIconButton(
        onClick = { sheet = Sheet.Settings },
        icon = { Icon(Icons.Default.Settings, contentDescription = stringResource(R.string.overlay_settings)) },
      )
    }
  }

  if (talkEnabled) {
    Popup(alignment = Alignment.Center, properties = PopupProperties(focusable = false)) {
      TalkOrbOverlay(
        seamColor = seamColor,
        statusText = talkStatusText,
        isListening = talkIsListening,
        isSpeaking = talkIsSpeaking,
      )
    }
  }

  val currentSheet = sheet
  if (currentSheet != null) {
    ModalBottomSheet(
      onDismissRequest = { sheet = null },
      sheetState = sheetState,
    ) {
      when (currentSheet) {
        Sheet.Chat -> ChatSheet(viewModel = viewModel)
        Sheet.Settings -> SettingsSheet(viewModel = viewModel)
      }
    }
  }
}

private enum class Sheet {
  Chat,
  Settings,
}

@Composable
private fun OverlayIconButton(
  onClick: () -> Unit,
  icon: @Composable () -> Unit,
  containerColor: ComposeColor? = null,
  contentColor: ComposeColor? = null,
) {
  FilledTonalIconButton(
    onClick = onClick,
    modifier = Modifier.size(44.dp),
    colors =
      IconButtonDefaults.filledTonalIconButtonColors(
        containerColor = containerColor ?: overlayContainerColor(),
        contentColor = contentColor ?: overlayIconColor(),
      ),
  ) {
    icon()
  }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
private fun CanvasView(viewModel: MainViewModel, modifier: Modifier = Modifier) {
  val context = LocalContext.current
  val isDebuggable = (context.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
  AndroidView(
    modifier = modifier,
    factory = {
      WebView(context).apply {
        settings.javaScriptEnabled = true
        // Some embedded web UIs (incl. the "background website") use localStorage/sessionStorage.
        settings.domStorageEnabled = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
          WebSettingsCompat.setAlgorithmicDarkeningAllowed(settings, false)
        } else {
          disableForceDarkIfSupported(settings)
        }
        if (isDebuggable) {
          Log.d("BuilderforceWebView", "userAgent: ${settings.userAgentString}")
        }
        isScrollContainer = true
        overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
        isVerticalScrollBarEnabled = true
        isHorizontalScrollBarEnabled = true
        webViewClient =
          object : WebViewClient() {
            override fun onReceivedError(
              view: WebView,
              request: WebResourceRequest,
              error: WebResourceError,
            ) {
              if (!isDebuggable) return
              if (!request.isForMainFrame) return
              Log.e("BuilderforceWebView", "onReceivedError: ${error.errorCode} ${error.description} ${request.url}")
            }

            override fun onReceivedHttpError(
              view: WebView,
              request: WebResourceRequest,
              errorResponse: WebResourceResponse,
            ) {
              if (!isDebuggable) return
              if (!request.isForMainFrame) return
              Log.e(
                "BuilderforceWebView",
                "onReceivedHttpError: ${errorResponse.statusCode} ${errorResponse.reasonPhrase} ${request.url}",
              )
            }

            override fun onPageFinished(view: WebView, url: String?) {
              if (isDebuggable) {
                Log.d("BuilderforceWebView", "onPageFinished: $url")
              }
              viewModel.canvas.onPageFinished()
            }

            override fun onRenderProcessGone(
              view: WebView,
              detail: android.webkit.RenderProcessGoneDetail,
            ): Boolean {
              if (isDebuggable) {
                Log.e(
                  "BuilderforceWebView",
                  "onRenderProcessGone didCrash=${detail.didCrash()} priorityAtExit=${detail.rendererPriorityAtExit()}",
                )
              }
              return true
            }
          }
        webChromeClient =
          object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
              if (!isDebuggable) return false
              val msg = consoleMessage ?: return false
              Log.d(
                "BuilderforceWebView",
                "console ${msg.messageLevel()} @ ${msg.sourceId()}:${msg.lineNumber()} ${msg.message()}",
              )
              return false
            }
          }
        // Use default layer/background; avoid forcing a black fill over WebView content.

        val a2uiBridge =
          CanvasA2UIActionBridge { payload ->
            viewModel.handleCanvasA2UIActionFromWebView(payload)
          }
        addJavascriptInterface(a2uiBridge, CanvasA2UIActionBridge.interfaceName)
        viewModel.canvas.attach(this)
      }
    },
  )
}

private fun disableForceDarkIfSupported(settings: WebSettings) {
  if (!WebViewFeature.isFeatureSupported(WebViewFeature.FORCE_DARK)) return
  @Suppress("DEPRECATION")
  WebSettingsCompat.setForceDark(settings, WebSettingsCompat.FORCE_DARK_OFF)
}

private class CanvasA2UIActionBridge(private val onMessage: (String) -> Unit) {
  @JavascriptInterface
  fun postMessage(payload: String?) {
    val msg = payload?.trim().orEmpty()
    if (msg.isEmpty()) return
    onMessage(msg)
  }

  companion object {
    const val interfaceName: String = "builderforceCanvasA2UIAction"
  }
}
