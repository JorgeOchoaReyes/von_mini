package expo.modules.nanobridge

import android.content.Intent
import android.content.pm.ApplicationInfo
import androidx.core.content.ContextCompat
import com.google.firebase.FirebaseApp
import com.google.firebase.ai.DownloadStatus
import com.google.firebase.ai.FirebaseAI
import com.google.firebase.ai.GenerativeModel
import com.google.firebase.ai.InferenceMode
import com.google.firebase.ai.InferenceSource
import com.google.firebase.ai.OnDeviceConfig
import com.google.firebase.ai.OnDeviceModelOption
import com.google.firebase.ai.OnDeviceModelStatus
import com.google.firebase.ai.type.GenerativeBackend
import com.google.firebase.ai.type.PublicPreviewAPI
import com.google.firebase.ai.type.content
import com.google.firebase.ai.type.generationConfig
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.google.firebase.remoteconfig.FirebaseRemoteConfigSettings
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.tasks.await

/**
 * Bridges Firebase AI Logic's Android SDK (hybrid inference) to JavaScript.
 *
 * Every request goes through one [GenerativeModel] configured with an [OnDeviceConfig], so
 * Firebase AI Logic decides between Gemini Nano (AICore, on the phone) and Gemini in the cloud
 * according to the requested [InferenceMode]. The response reports which one answered.
 *
 * The on-device model is selectable so the app can use **Gemini Nano 4** (`nano-v4-full` /
 * `nano-v4-fast`, published as the PREVIEW options) and fall back to the stable Nano on devices
 * where the preview is not available yet.
 */
@OptIn(PublicPreviewAPI::class)
class NanoBridgeModule : Module() {
  private var firebaseReady = false
  private val models = mutableMapOf<String, GenerativeModel>()

  override fun definition() = ModuleDefinition {
    Name("NanoBridge")

    Events("onDownloadProgress", "onStreamChunk")

    /**
     * Starts the foreground service that keeps the app alive while a build or edit runs, so it
     * survives the user switching away. Returns false when Android doesn't allow it right now.
     */
    Function("startKeepAlive") { title: String ->
      val context = appContext.reactContext ?: return@Function false
      try {
        ContextCompat.startForegroundService(context, Intent(context, KeepAliveService::class.java).putExtra(KeepAliveService.EXTRA_TITLE, title))
        true
      } catch (e: Exception) {
        false
      }
    }

    /** Stops the keep-alive service (and its notification). */
    Function("stopKeepAlive") {
      appContext.reactContext?.let { it.stopService(Intent(it, KeepAliveService::class.java)) }
      Unit
    }

    /** Reports whether the selected on-device model can run on this phone. */
    AsyncFunction("getStatus") Coroutine { cloudModel: String, modelOption: String ->
      val ext = model(cloudModel, "prefer_on_device", null, false, modelOption).onDeviceExtension
        ?: return@Coroutine "unavailable"
      statusName(ext.checkStatus())
    }

    /** The concrete on-device model this device would use, for example "nano-v4-full". */
    AsyncFunction("getModelName") Coroutine { cloudModel: String, modelOption: String ->
      model(cloudModel, "prefer_on_device", null, false, modelOption).onDeviceExtension?.getModelName() ?: ""
    }

    /** Downloads the on-device model (if needed) and streams progress to JS. */
    AsyncFunction("download") Coroutine { cloudModel: String, modelOption: String ->
      val ext = model(cloudModel, "prefer_on_device", null, false, modelOption).onDeviceExtension
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

    /**
     * Loads the model into memory so the first real request is fast. Best-effort: a failure here
     * must never break the app, so the exception is reported as `false` rather than thrown.
     */
    AsyncFunction("warmUp") Coroutine { cloudModel: String, modelOption: String ->
      try {
        model(cloudModel, "prefer_on_device", null, false, modelOption).onDeviceExtension?.warmUp()
        true
      } catch (e: Exception) {
        false
      }
    }

    /**
     * Firebase Remote Config. Sets the app's bundled defaults, fetches new values (throttled to
     * once an hour) and activates them. A failed fetch (offline, no project) is not an error: the
     * last activated values, or the defaults, are returned with `fetched = false`.
     */
    AsyncFunction("remoteConfig") Coroutine { defaults: Map<String, String> ->
      ensureFirebase()
      val rc = FirebaseRemoteConfig.getInstance()
      rc.setConfigSettingsAsync(
        FirebaseRemoteConfigSettings.Builder().setMinimumFetchIntervalInSeconds(3600).setFetchTimeoutInSeconds(8).build(),
      ).await()
      rc.setDefaultsAsync(defaults).await()
      val fetched = try {
        rc.fetchAndActivate().await()
      } catch (e: Exception) {
        false
      }
      mapOf("values" to defaults.keys.associateWith { rc.getString(it) }, "fetched" to fetched)
    }

    /** Runs one prompt with the requested inference mode. */
    AsyncFunction("generate") Coroutine {
        prompt: String, cloudModel: String, mode: String, system: String?, json: Boolean, modelOption: String ->
      val response = model(cloudModel, mode, system, json, modelOption).generateContent(prompt)
      mapOf(
        "text" to (response.text ?: ""),
        "source" to if (response.inferenceSource == InferenceSource.ON_DEVICE) "on_device" else "in_cloud",
      )
    }

    /**
     * Streams one prompt. Each chunk is sent as an `onStreamChunk` event tagged with `streamId`
     * so several streams can be in flight at once; the JS side assembles them.
     */
    AsyncFunction("streamGenerate") Coroutine {
        prompt: String, cloudModel: String, mode: String, system: String?, json: Boolean, modelOption: String, streamId: String ->
      var last = ""
      try {
        model(cloudModel, mode, system, json, modelOption).generateContentStream(prompt).collect { response ->
          val piece = response.text ?: ""
          if (piece.isNotEmpty()) {
            // Some SDK versions emit cumulative text and others emit deltas; normalise to cumulative.
            last = if (piece.startsWith(last)) piece else last + piece
            sendEvent(
              "onStreamChunk",
              mapOf(
                "streamId" to streamId,
                "text" to last,
                "done" to false,
                "source" to if (response.inferenceSource == InferenceSource.ON_DEVICE) "on_device" else "in_cloud",
              ),
            )
          }
        }
        sendEvent("onStreamChunk", mapOf("streamId" to streamId, "text" to last, "done" to true, "error" to null))
      } catch (e: Exception) {
        sendEvent(
          "onStreamChunk",
          mapOf("streamId" to streamId, "text" to last, "done" to true, "error" to (e.message ?: "stream failed")),
        )
      }
    }
  }

  private fun ensureFirebase() {
    if (firebaseReady) return
    val context = appContext.reactContext ?: throw IllegalStateException("React context is not ready")
    if (FirebaseApp.getApps(context).isEmpty()) {
      FirebaseApp.initializeApp(context)
        ?: throw IllegalStateException("Firebase is not configured. Add google-services.json (see README).")
    }
    // Release builds attest with Play Integrity, so only the genuine signed APK on a real device
    // can call Gemini once App Check is enforced; a copied API key alone is rejected. Works for
    // the GitHub-distributed APK too, with "Play recognized" set to not required in App Check.
    // Debug builds use the debug provider: the token is printed to logcat on first run; register
    // it in the Firebase console.
    val debuggable = (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0
    FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
      if (debuggable) DebugAppCheckProviderFactory.getInstance() else PlayIntegrityAppCheckProviderFactory.getInstance(),
    )
    firebaseReady = true
  }

  private fun model(
    cloudModel: String,
    mode: String,
    system: String?,
    json: Boolean,
    modelOption: String,
  ): GenerativeModel {
    val key = listOf(cloudModel, mode, system.orEmpty(), json.toString(), modelOption).joinToString("\u0000")
    return models.getOrPut(key) {
      ensureFirebase()
      FirebaseAI.getInstance(backend = GenerativeBackend.googleAI()).generativeModel(
        modelName = cloudModel,
        generationConfig = generationConfig {
          if (json) responseMimeType = "application/json"
          maxOutputTokens = maxOutputTokensFor(mode, json)
        },
        systemInstruction = system?.let { content { text(it) } },
        onDeviceConfig = OnDeviceConfig(mode = inferenceMode(mode), modelOption = modelOptionOf(modelOption)),
      )
    }
  }

  /**
   * Caps cloud output so one request can't run up the bill. Keep in sync with
   * `maxOutputTokensFor` in src/ai/engine.web.ts. Derived from the existing arguments so the
   * native signatures (and over-the-air JS compatibility) stay unchanged.
   */
  private fun maxOutputTokensFor(mode: String, json: Boolean): Int = when {
    mode == "only_in_cloud" -> 16_384 // a whole custom HTML app
    json -> 4_096 // an app spec or an edit
    else -> 1_024 // AI buttons, chat answers, voice replies
  }

  /** Maps the JS setting onto the SDK's model options. Gemini Nano 4 is behind the preview flags. */
  private fun modelOptionOf(name: String): OnDeviceModelOption = when (name) {
    "nano4_fast" -> OnDeviceModelOption.PREVIEW_FAST
    "stable" -> OnDeviceModelOption.STABLE
    else -> OnDeviceModelOption.PREVIEW
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
