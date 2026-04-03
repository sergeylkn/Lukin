#!/usr/bin/env bash
# ============================================================
# build-apk.sh — сборка APK для Android
# Запускай из корня проекта: bash build-apk.sh
# ============================================================

set -e

echo "=== YouTube RU Translator — сборка APK ==="

# Проверка Android SDK
if [ -z "$ANDROID_HOME" ]; then
  # Ищем стандартные пути
  for p in "$HOME/Android/Sdk" "$HOME/Library/Android/sdk" "/usr/local/lib/android/sdk"; do
    if [ -d "$p" ]; then
      export ANDROID_HOME="$p"
      break
    fi
  done
fi

if [ -z "$ANDROID_HOME" ] || [ ! -d "$ANDROID_HOME" ]; then
  echo ""
  echo "❌ Android SDK не найден!"
  echo ""
  echo "Варианты:"
  echo ""
  echo "  1) Если есть Android Studio — просто открой папку android/ в нём"
  echo "     и нажми Build → Build APK"
  echo ""
  echo "  2) EAS Cloud Build (бесплатно, не нужен SDK):"
  echo "     npm install -g eas-cli"
  echo "     eas login"
  echo "     eas build --platform android --profile preview"
  echo "     (APK скачается по ссылке)"
  echo ""
  exit 1
fi

echo "✓ Android SDK: $ANDROID_HOME"
echo ""

# Устанавливаем зависимости npm
echo "=== npm install ==="
npm install --legacy-peer-deps

# Собираем APK
echo ""
echo "=== Gradle assembleRelease ==="
cd android
chmod +x ./gradlew
./gradlew assembleRelease --no-daemon

APK_PATH=$(find . -name "*.apk" -path "*/release/*" | head -1)

if [ -n "$APK_PATH" ]; then
  DEST="../youtube-ru-translator.apk"
  cp "$APK_PATH" "$DEST"
  echo ""
  echo "✅ APK готов: $(realpath $DEST)"
  echo "   Размер: $(du -sh $DEST | cut -f1)"
  echo ""
  echo "Установка на телефон:"
  echo "  adb install $DEST"
  echo "  или просто скопируй файл на телефон и открой"
else
  echo "❌ APK не найден"
  exit 1
fi
