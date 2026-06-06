#!/bin/bash
set -e

SERVER_URL="${1:-}"
if [ -z "$SERVER_URL" ]; then
  echo "ERROR: Server URL required. Usage: ./build-apk.sh https://your-domain.com"
  exit 1
fi

if [ -z "${APK_KEYSTORE_PASS:-}" ]; then
  echo "ERROR: APK_KEYSTORE_PASS environment variable is required (keystore signing password)."
  exit 1
fi
export APK_KEYSTORE_PASS

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
OUTPUT_DIR="$SCRIPT_DIR/../public/apk"
KEYSTORE_DIR="$SCRIPT_DIR/keystore"

export ANDROID_HOME="${ANDROID_HOME:-/opt/android-sdk}"

# Pin JDK 17. AGP 8.2 + compileSdk 34 fails on JDK 21 (jlink/system-modules
# transform), so do NOT inherit whatever `java` happens to be on PATH.
JAVA_HOME="/usr/lib/jvm/java-17-openjdk-amd64"
if [ ! -x "$JAVA_HOME/bin/javac" ]; then
  echo "ERROR: JDK 17 not found at $JAVA_HOME (required — AGP 8.2 is incompatible with JDK 21)." >&2
  echo "ERROR: Install it: apt-get install -y openjdk-17-jdk" >&2
  exit 1
fi
export JAVA_HOME
export GRADLE_HOME="${GRADLE_HOME:-/opt/gradle-8.5}"
export PATH="$JAVA_HOME/bin:$GRADLE_HOME/bin:$ANDROID_HOME/build-tools/34.0.0:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"

echo "[BUILD] BuxTaxi Driver APK Builder"
echo "[BUILD] Server URL: $SERVER_URL"
echo "[BUILD] Android SDK: $ANDROID_HOME"
echo "[BUILD] Java: $JAVA_HOME"
echo "[BUILD] Gradle: $GRADLE_HOME"

DRIVER_URL="${SERVER_URL}/driver"
echo "[BUILD] Driver URL: $DRIVER_URL"

STRINGS_FILE="$PROJECT_DIR/app/src/main/res/values/strings.xml"
sed -i "s|https://PLACEHOLDER_URL/driver|${DRIVER_URL}|g" "$STRINGS_FILE"
sed -i "s|https://PLACEHOLDER_URL|${SERVER_URL}|g" "$STRINGS_FILE"
echo "[BUILD] Updated strings.xml with server URL"

if [ ! -f "$KEYSTORE_DIR/buxtaxi.keystore" ]; then
  echo "ERROR: Signing keystore not found at $KEYSTORE_DIR/buxtaxi.keystore" >&2
  echo "ERROR: Keystore not found — restore from backup. Do NOT generate a new one:" >&2
  echo "ERROR: a new key changes the app's signature, and every existing user would" >&2
  echo "ERROR: have to UNINSTALL before they could install the new APK." >&2
  exit 1
fi
echo "[BUILD] Using existing keystore"

# Monotonic versionCode (minutes since the Unix epoch) so every build is treated
# as an upgrade over the last; versionName carries a human-readable datestamp.
VERSION=$(date +"%Y%m%d.%H%M")
export APK_VERSION_CODE=$(( $(date +%s) / 60 ))
export APK_VERSION_NAME="1.0.${VERSION}"
echo "[BUILD] versionCode: $APK_VERSION_CODE  versionName: $APK_VERSION_NAME"

echo "[BUILD] Starting Gradle build..."
cd "$PROJECT_DIR"

"$GRADLE_HOME/bin/gradle" assembleRelease \
  --no-daemon \
  -Pandroid.sdk.dir="$ANDROID_HOME" \
  2>&1

APK_PATH="$PROJECT_DIR/app/build/outputs/apk/release/app-release.apk"
if [ ! -f "$APK_PATH" ]; then
  echo "[BUILD] ERROR: APK not found at $APK_PATH"
  APK_PATH=$(ls "$PROJECT_DIR/app/build/outputs/apk/release/"*.apk 2>/dev/null | head -1)
  if [ -z "$APK_PATH" ]; then
    echo "[BUILD] ERROR: No APK files found"
    exit 1
  fi
fi

FINAL_NAME="buxtaxi-driver-v${VERSION}.apk"

mkdir -p "$OUTPUT_DIR"
cp "$APK_PATH" "$OUTPUT_DIR/$FINAL_NAME"

echo "[BUILD] SUCCESS!"
echo "[BUILD] APK: $OUTPUT_DIR/$FINAL_NAME"
echo "[BUILD] Size: $(du -h "$OUTPUT_DIR/$FINAL_NAME" | cut -f1)"
echo "[BUILD] Version: $VERSION"

sed -i "s|${DRIVER_URL}|https://PLACEHOLDER_URL/driver|g" "$STRINGS_FILE"
sed -i "s|${SERVER_URL}|https://PLACEHOLDER_URL|g" "$STRINGS_FILE"

echo "$FINAL_NAME"
