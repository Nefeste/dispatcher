# Проба Godot: карта района «Диспетчера 03»

Проба для сравнения стеков ([uprava#121](https://github.com/Nefeste/uprava/issues/121)): владелец 19.11.2026 — «установи
godot на виртуальной машине и создай каталог с проектом, сделаем тест прототип на этом движке для сравнения».
Не часть игры: Expo-сборка этот каталог не берёт.

Сейчас в пробе — то же, что в игре на Skia (часть П2): карта района `nn-center` из **того же файла карты**
(`map/nn-center.bin` — байты `src/map/generated/nn-center.ts`, SHA-256 из паспорта `assets/map/nn-center.json`),
те же слои и цвета, сдвиг одним пальцем и масштаб двумя, счётчик кадров в углу. Данные карты — © участники
OpenStreetMap, ODbL 1.0.

## Что где

| Файл | Что |
|---|---|
| `project.godot` | Godot 4.7, рендер Compatibility (OpenGL ES 3 — как Skia v2 и веб), портрет 412 × 915 |
| `map_data.gd` | чтение файла карты: заголовок ASCII, массивы u8/u16/u32 — как `src/map/format.ts` |
| `map_view.gd` | слои: вода и зелень «чёт-нечет», железные дороги, улицы с обводкой; ширина на экране не зависит от масштаба |
| `camera.gd` | сдвиг, масштаб двумя пальцами, колесо мыши; карта заполняет экран, приближение до 12 раз |
| `main.gd`, `main.tscn` | сцена: карта, камера, подписи, счётчик кадров; `-- --sweep` — сам двигает камеру для снимков |
| `tools/export-map.ts` | `bun spikes/godot/tools/export-map.ts` — файл карты из игры в `map/` со сверкой с паспортом |
| `export_presets.cfg` | Android (только arm64, без Gradle, `games.gornitsa.probe.godot`, отладочный ключ) и Web |

## Как запустить в контейнере

```bash
# Godot 4.7.2 (SHA-512 сверен с SHA512-SUMS.txt выпуска) — /opt/godot, ссылка /usr/local/bin/godot
# шаблоны экспорта — только Android и Web, в ~/.local/share/godot/export_templates/4.7.2.stable/
godot --headless --path spikes/godot --import
xvfb-run -a godot --path spikes/godot --rendering-driver opengl3 --resolution 412x915 \
  --fixed-fps 10 --write-movie spikes/godot/out/frame.png --quit-after 28 -- --sweep     # кадры без окна
godot --headless --path spikes/godot --export-release "Android" build/dispatcher-godot-release.apk
godot --headless --path spikes/godot --export-release "Web" build/web/index.html
```

Android SDK — `/opt/android-sdk` (путь — в настройках редактора, `export/android/android_sdk_path`), Java 21.
Отладочный ключ Godot создаёт сам. APK пробы — не для магазина: свой идентификатор `games.gornitsa.probe.godot`,
отладочный ключ.

## Первые числа (19.11.2026)

| | Godot 4.7.2 | Expo + Skia (игра, П2) |
|---|---|---|
| APK, только arm64, выпуск | 26,6 МБ (`libgodot_android.so` — 76 МБ без сжатия) | замер — с П9 |
| Веб-сборка | `index.wasm` 39,5 МБ | CanvasKit 2,9 МБ в gzip + бандл |
| Кадр на телефоне владельца | замер владельцем | замер владельцем (П9) |

Дальше для сравнения — одни и те же три эталонных кадра в обоих стеках: стол диспетчера с картой, входящий звонок
с лицом звонящего, видеовставка «бригада выезжает» ([uprava#121](https://github.com/Nefeste/uprava/issues/121)).
