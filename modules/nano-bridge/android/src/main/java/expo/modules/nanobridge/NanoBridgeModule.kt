package expo.modules.nanobridge

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.util.Log
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
import com.google.firebase.ai.type.ThinkingLevel
import com.google.firebase.ai.type.generationConfig
import com.google.firebase.ai.type.thinkingConfig
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.remoteconfig.FirebaseRemoteConfig
import com.google.firebase.remoteconfig.FirebaseRemoteConfigSettings
import com.google.firebase.appcheck.debug.DebugAppCheckProviderFactory
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.ConcurrentHashMap
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.tasks.await


/** Where a native crash's stack trace is kept for the next launch (see takeNativeCrash). */
private const val CRASH_PREFS = "vm_native_crash"
/** How often a stream sends what is new (fewer, smaller events than one per chunk). */
private const val STREAM_EVENT_MS = 120L
@Volatile private var crashRecorderInstalled = false

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
  // Read from several threads at once (status checks while a request starts): must be thread-safe.
  private val models = ConcurrentHashMap<String, GenerativeModel>()

  override fun definition() = ModuleDefinition {
    Name("NanoBridge")

    Events("onDownloadProgress", "onStreamChunk")

    // A native crash otherwise leaves no trace the app can show. Keep its stack trace, so the next
    // launch can say exactly what failed (see takeNativeCrash and src/diagnostics/crashNotes.ts).
    OnCreate { installCrashRecorder() }

    /** The last native crash's stack trace, once (then forgotten), or null. */
    Function("takeNativeCrash") {
      val prefs = appContext.reactContext?.getSharedPreferences(CRASH_PREFS, Context.MODE_PRIVATE) ?: return@Function null
      val last = prefs.getString("last", null)
      prefs.edit().remove("last").apply()
      last
    }

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
      val response = try {
        model(cloudModel, mode, system, json, modelOption).generateContent(prompt)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Throwable) {
        // An Error (not just an Exception) must fail this request, never the whole app.
        throw Exception(e.message ?: e.javaClass.simpleName, e)
      }
      mapOf(
        "text" to (response.text ?: ""),
        "source" to if (response.inferenceSource == InferenceSource.ON_DEVICE) "on_device" else "in_cloud",
      )
    }

    /** True: streams send only the new text (`delta`), not the whole text so far. */
    Function("streamsDeltas") { true }

    /**
     * Streams one prompt. Chunks are sent as `onStreamChunk` events tagged with `streamId`, so
     * several streams can be in flight at once. Each event carries only the text that is new since
     * the last one (`delta`), at most every [STREAM_EVENT_MS]: sending the whole text so far with
     * every chunk made hundreds of ever-larger copies of a big app, which backed up in memory and
     * ran the app out of it.
     */
    AsyncFunction("streamGenerate") Coroutine {
        prompt: String, cloudModel: String, mode: String, system: String?, json: Boolean, modelOption: String, streamId: String ->
      val all = StringBuilder()
      val pending = StringBuilder()
      var lastSent = 0L
      var source = "in_cloud"
      fun flush(done: Boolean, error: String? = null) {
        val event = mutableMapOf<String, Any?>(
          "streamId" to streamId,
          "text" to pending.toString(),
          "delta" to true,
          "done" to done,
          "source" to source,
        )
        if (done) event["error"] = error
        pending.setLength(0)
        lastSent = SystemClock.uptimeMillis()
        sendEvent("onStreamChunk", event)
      }
      try {
        model(cloudModel, mode, system, json, modelOption).generateContentStream(prompt).collect { response ->
          val piece = response.text ?: ""
          if (piece.isEmpty()) return@collect
          source = if (response.inferenceSource == InferenceSource.ON_DEVICE) "on_device" else "in_cloud"
          // Some SDK versions emit cumulative text and others deltas: keep only what's new.
          val cumulative = all.isNotEmpty() && piece.length > all.length && piece.regionMatches(0, all.toString(), 0, all.length)
          val fresh = if (cumulative) piece.substring(all.length) else piece
          all.append(fresh)
          pending.append(fresh)
          if (SystemClock.uptimeMillis() - lastSent >= STREAM_EVENT_MS) flush(false)
        }
        flush(true)
      } catch (e: CancellationException) {
        throw e
      } catch (e: Throwable) {
        // Any Throwable (an Error too): end this stream with a message, never crash the app.
        Log.e("NanoBridge", "stream failed", e)
        try {
          flush(true, e.message ?: e.javaClass.simpleName)
        } catch (_: Throwable) {
        }
      }
    }
  }

  @Synchronized
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

  private fun installCrashRecorder() {
    if (crashRecorderInstalled) return
    val context = appContext.reactContext?.applicationContext ?: return
    crashRecorderInstalled = true
    val previous = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      try {
        context.getSharedPreferences(CRASH_PREFS, Context.MODE_PRIVATE).edit()
          .putString("last", "${error.javaClass.name} on ${thread.name}: ${Log.getStackTraceString(error)}".take(4000))
          .commit()
      } catch (_: Throwable) {
      }
      previous?.uncaughtException(thread, error)
    }
  }

  @Synchronized
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
      val html = isHtmlWriter(system)
      FirebaseAI.getInstance(backend = GenerativeBackend.googleAI()).generativeModel(
        modelName = cloudModel,
        generationConfig = generationConfig {
          if (json) responseMimeType = "application/json"
          maxOutputTokens = if (html) HTML_MAX_OUTPUT_TOKENS else maxOutputTokensFor(mode, json)
          // Writing an app's code: think briefly, then write. Its thinking counts against the same
          // output limit, and long deliberation is what made big games slow or cut off.
          if (html && !cloudModel.contains("lite")) thinkingConfig = thinkingConfig { thinkingLevel = ThinkingLevel.LOW }
        },
        systemInstruction = system?.let { content { text(it) } },
        onDeviceConfig = OnDeviceConfig(mode = inferenceMode(mode), modelOption = modelOptionOf(modelOption)),
      )
    }
  }

  /**
   * Whether this model writes a whole HTML app, recognised by its system prompt (HTML_SYSTEM and
   * HTML_PATCH_SYSTEM in src/ai/prompts.ts both start with this). Keeps the native signatures as
   * they are.
   */
  private fun isHtmlWriter(system: String?): Boolean =
    system?.startsWith("You write one self-contained mobile-first HTML file") == true

  /**
   * Caps cloud output so one request can't run up the bill. Keep in sync with
   * `maxOutputTokensFor` in src/ai/engine.web.ts. Derived from the existing arguments so the
   * native signatures (and over-the-air JS compatibility) stay unchanged.
   */
  private val HTML_MAX_OUTPUT_TOKENS = 32_768 // a whole custom HTML app; keep in sync with engine.web.ts

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
