// из anamnez: plugins/with-release-signing.js @ d05c615 — свойства DISPATCHER_*.
// Постоянный ключ подписи релизной сборки (ADR 0006 устава; docs/05-process.md, «Сборка APK»).
//
// Папки android/ в репозитории нет — её создаёт `expo prebuild`, поэтому подпись
// настраивается здесь, а не правкой build.gradle. Отладочным ключом шаблона релиз не выпускается
// никогда: CI без секретов ключа собирает APK только на проверку и выбрасывает его.
//
// Ключ приходит свойствами Gradle — в CI это переменные ORG_GRADLE_PROJECT_DISPATCHER_UPLOAD_*
// из секретов репозитория (.github/workflows/android.yml).
const { withAppBuildGradle } = require('expo/config-plugins');

const STORE = 'DISPATCHER_UPLOAD_STORE_FILE';

/**
 * Дописывает в build.gradle релизную подпись. Шаблон build.gradle меняется от версии
 * к версии Expo; если он изменился так, что подпись встать не может, — исключение.
 */
function addReleaseSigning(gradle) {
  if (gradle.includes(STORE)) return gradle;
  const configs = /signingConfigs\s*\{/;
  const release = /(buildTypes\s*\{[\s\S]*?\brelease\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
  if (!configs.test(gradle) || !release.test(gradle)) {
    throw new Error('with-release-signing: шаблон android/app/build.gradle изменился — подпись релиза не настроена');
  }
  return gradle
    .replace(configs, m => `${m}
        release {
            if (project.hasProperty('${STORE}')) {
                storeFile file(project.property('${STORE}'))
                storePassword project.property('DISPATCHER_UPLOAD_STORE_PASSWORD')
                keyAlias project.property('DISPATCHER_UPLOAD_KEY_ALIAS')
                keyPassword project.property('DISPATCHER_UPLOAD_KEY_PASSWORD')
            }
        }`)
    .replace(release, `$1signingConfig(project.hasProperty('${STORE}') ? signingConfigs.release : signingConfigs.debug)`);
}

const withReleaseSigning = config => withAppBuildGradle(config, c => {
  if (c.modResults.language !== 'groovy') throw new Error('with-release-signing: ожидался build.gradle на Groovy');
  c.modResults.contents = addReleaseSigning(c.modResults.contents);
  return c;
});

module.exports = withReleaseSigning;
module.exports.addReleaseSigning = addReleaseSigning;
