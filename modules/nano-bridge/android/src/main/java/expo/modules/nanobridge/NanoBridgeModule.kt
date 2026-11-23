package expo.modules.nanobridge

import com.google.firebase.FirebaseApp
import com.google.firebase.ai.DownloadStatus
import com.google.firebase.ai.FirebaseAI
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Bridges Firebase AI Logic's Android SDK (hybrid inference) to JavaScript.
 *
 * Every request goes through one GenerativeModel configured with an [OnDeviceConfig], so
 * Firebase AI Logic decides between Gemini Nano (AICore, on the phone) and Gemini in the cloud
 * according to the requested [InferenceMode]. The response reports which one answered.
 */
@OptIn(PublicPreviewAPI::class)
class NanoBridgeModule : Module() {
  private var firebaseReady = false
  private val models = mutableMapOf<String, GenerativeModel>()

  override fun definition() = ModuleDefinition {
    Name("NanoBridge")

    Events("onDownloadProgress")

    /** Reports whether Gemini Nano can run on this phone. */
    AsyncFunction("getStatus") Coroutine { cloudModel: String ->
      val ext = model(cloudModel, "prefer_on_device", null, false).onDeviceExtension
        ?: return@Coroutine "unavailable"
      statusName(ext.checkStatus())
    }

    /** Downloads Gemini Nano (if needed) and streams progress to JS. */
    AsyncFunction("download") Coroutine { cloudModel: String ->
      val ext = model(cloudModel, "prefer_on_device", null, false).onDeviceExtension
        ?: return@Coroutine "unavailable"
      var total = 0L
      ext.download().collect { status ->
        when (status) {
          is DownloadStatus.DownloadStarted -> {
            total = status.bytesToDownload
            sendEvent("onDownloadProgress", mapOf("downloaded" to 0L, "total" to total))
          }
          is DownloadStatus.DownloadInProgress ->
            sendEvent(
              "onDownloadProgress",
              mapOf("downloaded" to status.totalBytesDownloaded, "total" to total),
            )
          is DownloadStatus.DownloadFailed -> throw status.exception
          else -> Unit
        }
      }
      statusName(ext.checkStatus())
    }

    /** Runs one prompt with the requested inference mode. */
    AsyncFunction("generate") Coroutine {
        prompt: String, cloudModel: String, mode: String, system: String?, json: Boolean ->
      val response = model(cloudModel, mode, system, json).generateContent(prompt)
      mapOf(
        "text" to (response.text ?: ""),
        "source" to if (response.inferenceSource == InferenceSource.ON_DEVICE) "on_device" else "in_cloud",
      )
    }
  }

  private fun ensureFirebase() {
    if (firebaseReady) return
    val context = appContext.reactContext ?: throw IllegalStateException("React context is not ready")
    if (FirebaseApp.getApps(context).isEmpty()) {
      FirebaseApp.initializeApp(context)
        ?: throw IllegalStateException("Firebase is not configured. Add google-services.json (see README).")
    }
    // Debug provider: the token is printed to logcat on first run; register it in the Firebase console.
    FirebaseAppCheck.getInstance().installAppCheckProviderFactory(DebugAppCheckProviderFactory.getInstance())
    firebaseReady = true
  }

  private fun model(cloudModel: String, mode: String, system: String?, json: Boolean): GenerativeModel {
    val key = listOf(cloudModel, mode, system.orEmpty(), json.toString()).joinToString("\u0000")
    return models.getOrPut(key) {
      ensureFirebase()
      FirebaseAI.getInstance(backend = GenerativeBackend.googleAI()).generativeModel(
        modelName = cloudModel,
        generationConfig = if (json) generationConfig { responseMimeType = "application/json" } else null,
        systemInstruction = system?.let { content { text(it) } },
        onDeviceConfig = OnDeviceConfig(mode = inferenceMode(mode)),
      )
    }
  }

  private fun inferenceMode(mode: String): InferenceMode = when (mode) {
    "only_on_device" -> InferenceMode.ONLY_ON_DEVICE
    "prefer_in_cloud" -> InferenceMode.PREFER_IN_CLOUD
    "only_in_cloud" -> InferenceMode.ONLY_IN_CLOUD
    else -> InferenceMode.PREFER_ON_DEVICE
  }

  private fun statusName(status: OnDeviceModelStatus): String = when (status) {
    OnDeviceModelStatus.AVAILABLE -> "available"
    OnDeviceModelStatus.DOWNLOADABLE -> "downloadable"
    OnDeviceModelStatus.DOWNLOADING -> "downloading"
    else -> "unavailable"
  }
}
