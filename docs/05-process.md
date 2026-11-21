# Процесс

Общий порядок работы — устав, [`docs/04-process.md`](https://github.com/Nefeste/gornitsa/blob/main/docs/04-process.md).
Здесь — как он устроен в «Диспетчере 03».

## Ветки и слияние

- Работа — в ветках `claude/<задача>`, в `main` — через PR.
- **Кто сливает** — по классу изменения
  ([ADR 0018 устава](https://github.com/Nefeste/gornitsa/blob/main/adr/0018-change-classes-automerge.md)). Пути
  владельца — в [`.github/CODEOWNERS`](../.github/CODEOWNERS); такие PR сливает только владелец. Остальное сливается
  само (`automerge.yml` из набора `gornitsa-kit`): зелёные «Типы, линтер, тесты» и метка «ревью: ок» от ревьюера из
  другой сессии. Своему PR агент эту метку не ставит.
- Автослиянию нужен секрет `AUTOMERGE_TOKEN` в настройках репозитория; его заводит владелец.
- Репозиторий открыт до 1.0.0 (ADR [0008](adr/0008-open-until-1.0.md)).

## Проверки на PR

`.github/workflows/pr.yml` — типы, линтер, тесты на каждом PR, без сборки APK
([ADR 0019 устава](https://github.com/Nefeste/gornitsa/blob/main/adr/0019-ci-on-pr.md)). APK собирается только по тегу
версии — ниже, «Сборка APK».

## Версии

- Номер — X.Y.Z, всегда три числа. До магазина — 0.Y.Z; первый выпуск в RuStore — 1.0.0.
- Номер живёт в `app.json` (`expo.version`, `android.versionCode`), `package.json`, `package-lock.json`,
  `src/version.ts` и строке «Версия» в `STATUS.md`; `tools/test/version.test.ts` сверяет их.
- У каждой версии — раздел `### X.Y.Z — …` в корневом `README.md`: что изменилось для игрока.
- С 0.24.0 у каждой версии — образец сохранений в `tools/test/fixtures/saves/` (`docs/06-testing.md`): обновление не
  теряет станцию, неделю, лучшие итоги и настройки.
- Части прототипа идут версиями 0.Y.0: П1 — 0.1.0, дальше по номеру части. Тег на сборку ставит владелец.

## Сборка APK

`.github/workflows/android.yml` (с части П9; копия `android.yml` «Анамнеза»), только на тег `vX.Y.Z` — ручного запуска
нет, слияние в `main` сборку не запускает ([ADR 0019 устава](https://github.com/Nefeste/gornitsa/blob/main/adr/0019-ci-on-pr.md)):

1. **Тег и версия** — тег называет версию из `app.json`, иначе сборка останавливается сразу.
2. **Типы, линтер, тесты** — те же, что на PR. Сценарий в браузере агент гоняет перед тегом у себя: в CI браузера нет.
3. **Ключ подписи** — есть ли секреты постоянного ключа и отпечаток `ANDROID_CERT_SHA256`.
4. **Сборка APK** — содержание, `expo prebuild`, Gradle, только 64-битный ARM. Ключ, подпись и содержимое — действия
   набора `gornitsa-kit@v1` ([ADR 0022 устава](https://github.com/Nefeste/gornitsa/blob/main/adr/0022-kit-v1.md)):
   подпись сверяется на готовом файле; разрешения — ровно по белому списку
   [`.github/apk-permissions.txt`](../.github/apk-permissions.txt), сети нет (`INTERNET` и состояние сети вырезает из
   выпускной сборки `plugins/with-release-no-internet.js`; отладочной сборке сеть нужна для Metro), резервная копия
   Android выключена (`allowBackup: false`), target API — не ниже 36, размер — не больше 80 МБ.
5. **Выпуск** — только с постоянным ключом: GitHub Release на этот тег, «Latest», с разделом версии из `README.md`;
   APK скачивается на телефон со страницы выпуска. Без ключа APK собирается только на проверку и выбрасывается: файл,
   подписанный отладочным ключом, не должен попасть ни на чей телефон
   ([ADR 0006 устава](https://github.com/Nefeste/gornitsa/blob/main/adr/0006-permanent-app-id-and-key.md)).

**Разрешения.** В выпускном APK — только `MODIFY_AUDIO_SETTINGS` (режим звука `expo-audio`) и служебное
`games.gornitsa.dispatcher.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` (androidx). Вибрация на звонке — системный
виброотклик (`performHapticFeedback`), ему разрешение `VIBRATE` не нужно, и оно заблокировано в `app.json`. Новое
разрешение — в белый список, сюда и в раздел игры в политике конфиденциальности (устав, `docs/05-rules.md`), ненужное
— в `blockedPermissions` в `app.json`.

**Перед тегом** агент: проверки, веб-сборка и сценарий в браузере (`docs/06-testing.md`), версия во всех файлах и
раздел версии в `README.md`. Тег ставит владелец.

## Ключ подписи

Постоянный ключ выбирается к первой сборке, которую кто-то поставит на телефон, и больше не меняется
([ADR 0006 устава](https://github.com/Nefeste/gornitsa/blob/main/adr/0006-permanent-app-id-and-key.md)): сборку с другим
ключом Android поставит только после удаления игры вместе с сохранениями. Ключ заводит владелец, один раз; агент
ключей и паролей не видит и не хранит.

```bash
keytool -genkeypair -v -keystore dispatcher-release.jks -alias dispatcher \
  -keyalg RSA -keysize 4096 -validity 36500 \
  -dname "CN=Gornitsa, O=Gornitsa, C=RU"                       # спросит два пароля — записать
base64 -w0 dispatcher-release.jks > dispatcher-release.jks.b64    # macOS: base64 -i dispatcher-release.jks
keytool -list -v -keystore dispatcher-release.jks -alias dispatcher | grep SHA256
```

`keytool` — из JDK 17 или из Android Studio (`jbr/bin`). В Windows вместо `base64` — PowerShell, строка сразу попадёт в
буфер обмена: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("$PWD\dispatcher-release.jks")) | Set-Clipboard`.

В репозитории → Settings → Secrets and variables → Actions:

| Имя | Что |
|---|---|
| `ANDROID_KEYSTORE_BASE64` (секрет) | содержимое `.b64` |
| `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD` (секреты) | два пароля из `keytool` |
| `ANDROID_KEY_ALIAS` (секрет) | `dispatcher` |
| `ANDROID_CERT_SHA256` (переменная) | отпечаток из последней строки: APK с другим ключом сборка не выпустит |

Сам файл `.jks` и пароли — в двух местах вне GitHub: потерянный ключ — это новое приложение. Отдельной проверки
ключа без тега нет: его проверяет первый же тег — задание «Ключ подписи» останавливает запуск, если секреты заданы не
все или нет `ANDROID_CERT_SHA256`, а шаг «Подпись» — если отпечаток готового файла не совпал; выпуска тогда нет.

## Медицина и содержание

Записи содержания идут не спецификациями, а записями и отчётами ([`09-content.md`](09-content.md)): запись в
`content/`, валидатор, отчёт «виртуального диспетчера» в описании коммита.
