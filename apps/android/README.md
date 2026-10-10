## Builderforce for Android

The Builderforce phone app has two halves:

- **Chat with the Brain** runs on builderforce.ai, in the same chats as the web app, the VS Code
  extension and the Synapse desktop app (`/api/brain/chats`). The Brain answers on the phone,
  streaming from the LLM gateway with the workspace's platform tools. A tool that changes
  something asks you to approve it first. Messages addressed to an assigned agent (`@Name`, or
  the composer's **To** choice) are answered by that agent on the platform.
- **Node features** (camera, location, SMS, screen recording, canvas, Voice Wake, Talk Mode) run
  on a local agent-runtime gateway that you start with `builderforce gateway`. The phone joins
  that gateway as a node.

Supports modern Android only (`minSdk 31`, Kotlin and Jetpack Compose).

## Sign in (chat)

1. Open **Chat**. Signed out, it shows **Sign in to Builderforce**.
2. Tap **Sign in**. The app shows a code and opens builderforce.ai/activate in your browser.
3. Approve the code there. The app receives its own key, named after the app, and keeps it in
   encrypted storage on the device.

Switch workspace or sign out under **Settings → Builderforce account**. For development, the
same section has a **Server** field. Leave it blank to use `https://builderforce.ai/gateway`.

## Node features: connect and pair

1. Start the gateway on your machine:
   ```bash
   builderforce gateway --port 18789 --verbose
   ```
2. In the app, open **Settings** and pick a gateway under **Discovered Gateways**
   (`_builderforce-gw._tcp`), or use **Advanced → Manual Gateway** (host and port).
3. Approve the pairing on the gateway machine:
   ```bash
   builderforce nodes pending
   builderforce nodes approve <requestId>
   ```

A foreground service keeps the node connected. Its notification has a Disconnect action.

## Open in Android Studio

Open the folder `apps/android`.

## Build and run

```bash
cd apps/android
./gradlew :app:assembleDebug
./gradlew :app:installDebug
./gradlew :app:testDebugUnitTest
```

The APK is named `builderforce-<version>-<buildType>.apk`. `gradlew` finds the Android SDK at
`~/Library/Android/sdk` (the macOS default) when `ANDROID_SDK_ROOT` and `ANDROID_HOME` are unset.

## Permissions

- Discovery:
  - Android 13+ (`API 33+`): `NEARBY_WIFI_DEVICES`
  - Android 12 and below: `ACCESS_FINE_LOCATION` (required for NSD scanning)
- Foreground service notification (Android 13+): `POST_NOTIFICATIONS`
- Camera:
  - `CAMERA` for `camera.snap` and `camera.clip`
  - `RECORD_AUDIO` for `camera.clip` when `includeAudio=true`
- Dictation in the chat composer, Voice Wake and Talk Mode: `RECORD_AUDIO`
