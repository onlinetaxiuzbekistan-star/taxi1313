#!/bin/bash
ANDROID_HOME="${ANDROID_HOME:-/home/runner/.android-sdk}"
GRADLE_HOME="${GRADLE_HOME:-/home/runner/.gradle-dist/gradle-8.5}"
GRADLE_ZIP_URL="https://services.gradle.org/distributions/gradle-8.5-bin.zip"
CMDTOOLS_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"

JAVA_HOME_RESOLVED=$(dirname $(dirname $(readlink -f $(which java 2>/dev/null) 2>/dev/null) 2>/dev/null) 2>/dev/null)

check_all() {
  [ -f "$ANDROID_HOME/build-tools/34.0.0/aapt2" ] && \
  [ -f "$ANDROID_HOME/platforms/android-34/android.jar" ] && \
  [ -f "$GRADLE_HOME/bin/gradle" ]
}

if check_all; then
  echo "[APK-SETUP] All Android build tools present — skipping install"
  exit 0
fi

echo "[APK-SETUP] Installing missing Android build tools..."

if [ ! -f "$GRADLE_HOME/bin/gradle" ]; then
  echo "[APK-SETUP] Downloading Gradle 8.5..."
  mkdir -p "$(dirname "$GRADLE_HOME")"
  cd "$(dirname "$GRADLE_HOME")"
  curl -sL "$GRADLE_ZIP_URL" -o gradle.zip
  unzip -q -o gradle.zip
  rm -f gradle.zip
  echo "[APK-SETUP] Gradle 8.5 installed"
fi

if [ ! -f "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" ]; then
  echo "[APK-SETUP] Downloading Android SDK command-line tools..."
  mkdir -p "$ANDROID_HOME/cmdline-tools"
  cd /tmp
  curl -sL "$CMDTOOLS_URL" -o cmdtools.zip
  rm -rf /tmp/cmdline-tools
  unzip -q -o cmdtools.zip
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mv cmdline-tools "$ANDROID_HOME/cmdline-tools/latest"
  rm -f cmdtools.zip
  echo "[APK-SETUP] SDK command-line tools installed"
fi

if [ ! -f "$ANDROID_HOME/build-tools/34.0.0/aapt2" ] || [ ! -f "$ANDROID_HOME/platforms/android-34/android.jar" ]; then
  echo "[APK-SETUP] Installing build-tools and platform..."
  export JAVA_HOME="$JAVA_HOME_RESOLVED"
  yes | "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" --licenses > /dev/null 2>&1
  "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$ANDROID_HOME" "build-tools;34.0.0" "platforms;android-34" > /dev/null 2>&1
  echo "[APK-SETUP] SDK components installed"
fi

if check_all; then
  echo "[APK-SETUP] All tools installed successfully!"
else
  echo "[APK-SETUP] WARNING: Some tools may still be missing"
fi
