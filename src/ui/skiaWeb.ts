// Веб: прежняя картинка холста освобождается (только веб-сборка — сценарий в браузере, снимки магазина; телефон этот
// модуль не грузит). В вебе Skia 2.6.2 — это CanvasKit (WASM): объект Skia живёт, пока у него не вызван dispose(), сборщик
// мусора его не видит. Холст при каждой перерисовке — а холст с анимацией (карта, машины с маячками, круги вызова на
// заглавном) перерисовывается каждый кадр — записывает новую картинку (SkPicture) и отдаёт её виду через
// `SkiaViewApi.setJsiProperty(id, 'picture', …)` (@shopify/react-native-skia, sksg/Container.web.js, StaticContainer.js);
// вид в вебе (views/SkiaPictureView.web.js, setPicture) прежнюю просто забывает. Картинка — список команд, она мала;
// главная утечка кучи была другой — картинки и шрифты экранов (src/ui/skiaAssets.ts, docs/06-testing.md). Но и эта
// копится с каждым кадром. Картинку записывает контейнер и отдаёт только сюда — больше её никто не держит; вид рисует
// новую в следующем кадре. Поэтому прежнюю картинку того же вида освобождаем, как только пришла новая. На телефоне вид
// держит картинку сам (sk_sp) и отпускает прежнюю.

interface Disposable {
  dispose?: () => void;
}
interface ViewApi {
  setJsiProperty: (nativeId: string | number, name: string, value: unknown) => void;
}

let installed = false;

/** Вызвать в вебе один раз, после загрузки CanvasKit и модуля приложения (там Skia создаёт `SkiaViewApi`), до первого холста. */
export function freeReplacedPictures(): void {
  const api = (globalThis as { SkiaViewApi?: ViewApi }).SkiaViewApi;
  if (installed || !api) return;
  installed = true;
  const set = api.setJsiProperty.bind(api);
  const last = new Map<string, Disposable>();
  api.setJsiProperty = (nativeId, name, value) => {
    set(nativeId, name, value);
    if (name !== 'picture' || !value) return;
    const key = `${nativeId}`;
    const prev = last.get(key);
    last.set(key, value as Disposable);
    if (prev && prev !== value) {
      try {
        prev.dispose?.();
      } catch {
        // уже освобождена — ничего страшного
      }
    }
  };
}
