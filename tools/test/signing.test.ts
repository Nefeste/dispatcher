// из nardy: tools/test/signing.test.ts @ 3ab05ab — свойства DISPATCHER_*, и выпускная сборка без сети.
// Постоянный ключ подписи (ADR 0006 устава): плагин дописывает релизную подпись в build.gradle,
// который создаёт `expo prebuild`. Сам Gradle здесь не запустить — проверяется, что правка
// встаёт в шаблон как задумано, и что при изменившемся шаблоне сборка падает, а не тихо
// подписывается отладочным ключом.
import { describe, expect, test } from 'bun:test';

const { addReleaseSigning } = require('../../plugins/with-release-signing.js') as { addReleaseSigning: (g: string) => string };

/** Кусок android/app/build.gradle из шаблона Expo SDK 57 — ровно то, что меняет плагин. */
const TEMPLATE = `
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
        }
    }
`;

describe('подпись релиза', () => {
  const out = addReleaseSigning(TEMPLATE);

  test('релиз подписывается постоянным ключом, только если он передан', () => {
    expect(out).toContain("signingConfig(project.hasProperty('DISPATCHER_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug)");
    expect(out).toContain("storeFile file(project.property('DISPATCHER_UPLOAD_STORE_FILE'))");
  });

  test('отладочная сборка остаётся на отладочном ключе', () => {
    const debug = out.slice(out.indexOf('buildTypes'), out.indexOf('release {', out.indexOf('buildTypes')));
    expect(debug).toContain('signingConfig signingConfigs.debug');
  });

  test('ровно одна замена: отладочный ключ у релиза больше не указан напрямую', () => {
    const release = out.slice(out.indexOf('release {', out.indexOf('buildTypes')));
    expect(release).not.toMatch(/signingConfig\s+signingConfigs\.debug/);
  });

  test('повторный prebuild ничего не задваивает', () => {
    expect(addReleaseSigning(out)).toBe(out);
  });

  test('изменившийся шаблон — исключение, а не тихий отладочный ключ', () => {
    expect(() => addReleaseSigning(TEMPLATE.replace('signingConfig signingConfigs.debug\n            def', 'def'))).toThrow(/шаблон/);
    expect(() => addReleaseSigning('android { }')).toThrow(/шаблон/);
  });
});

describe('выпускная сборка без сети', () => {
  test('манифест варианта release вырезает INTERNET и состояние сети, отладочный не трогает', () => {
    const { REMOVED } = require('../../plugins/with-release-no-internet.js') as { REMOVED: string[] };
    expect(REMOVED).toEqual(['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE']);
  });
  test('оба плагина подключены в app.json', () => {
    const app = require('../../app.json') as { expo: { plugins: (string | unknown[])[] } };
    const names = app.expo.plugins.map(p => (typeof p === 'string' ? p : String(p[0])));
    expect(names).toContain('./plugins/with-release-signing.js');
    expect(names).toContain('./plugins/with-release-no-internet.js');
  });
});
