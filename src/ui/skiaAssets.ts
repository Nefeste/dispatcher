// Картинки и шрифты Skia — один раз на всю игру. `useImage` и `useFont` из Skia загружают файл заново при каждом
// появлении экрана и прежний объект не освобождают. На телефоне его со временем подберёт сборщик мусора, а в вебе Skia —
// это CanvasKit (WASM), и раскодированная картинка остаётся в его куче навсегда: ~13 МБ на каждый переход «заглавный —
// настройки» (кадр зала дважды), а за смену сценария в браузере — до предела кучи, после чего новые картинки и шрифты
// перестают создаваться (замер 22.11.2026, docs/06-testing.md). Здесь каждый файл грузится один раз, картинка и шрифт
// живут до конца игры и отдаются каждому экрану готовыми: экраны их не освобождают. Игре это и быстрее — стол пульта и
// звонящие не раскодируются при каждом возвращении на экран. Всего файлов немного: кадры сцен, двенадцать звонящих,
// три начертания Onest.
import { type DataSourceParam, loadData, Skia, type SkFont, type SkImage, type SkTypeface } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';

type Key = NonNullable<DataSourceParam>;

function cached<T>(made: Map<Key, T>, loading: Map<Key, Promise<T | null>>, source: Key, make: (d: Parameters<Parameters<typeof loadData>[1]>[0]) => T | null): Promise<T | null> {
  const hit = made.get(source);
  if (hit) return Promise.resolve(hit);
  let p = loading.get(source);
  if (!p) {
    p = loadData(source, make).then(
      x => {
        loading.delete(source);
        if (x) made.set(source, x);
        return x;
      },
      () => {
        // не загрузилось — следующий экран попробует снова
        loading.delete(source);
        return null;
      },
    );
    loading.set(source, p);
  }
  return p;
}

/** Готовое или загружаемое по ключу: пока не готово — null, как у `useImage`. */
function useCached<T>(source: DataSourceParam, made: Map<Key, T>, load: (s: Key) => Promise<T | null>): T | null {
  const [got, setGot] = useState<{ source: DataSourceParam; value: T | null }>(() => ({ source, value: source == null ? null : (made.get(source) ?? null) }));
  useEffect(() => {
    if (source == null || made.get(source)) return;
    let alive = true;
    void load(source).then(value => {
      if (alive) setGot({ source, value });
    });
    return () => {
      alive = false;
    };
  }, [source, made, load]);
  if (source == null) return null;
  return made.get(source) ?? (got.source === source ? got.value : null);
}

const images = new Map<Key, SkImage>();
const imagesLoading = new Map<Key, Promise<SkImage | null>>();
const loadImage = (s: Key) => cached(images, imagesLoading, s, d => Skia.Image.MakeImageFromEncoded(d));

/** Как `useImage` Skia, но одна картинка на файл на всю игру. */
export function useSkiaImage(source: DataSourceParam): SkImage | null {
  return useCached(source, images, loadImage);
}

const typefaces = new Map<Key, SkTypeface>();
const typefacesLoading = new Map<Key, Promise<SkTypeface | null>>();
const loadTypeface = (s: Key) => cached(typefaces, typefacesLoading, s, d => Skia.Typeface.MakeFreeTypeFaceFromData(d));
const fonts = new Map<SkTypeface, Map<number, SkFont>>();

function fontOf(tf: SkTypeface, size: number): SkFont {
  let bySize = fonts.get(tf);
  if (!bySize) fonts.set(tf, (bySize = new Map()));
  let f = bySize.get(size);
  if (!f) bySize.set(size, (f = Skia.Font(tf, size)));
  return f;
}

/** Как `useFont` Skia: начертание грузится один раз на файл, шрифт — один на начертание и размер. */
export function useSkiaFont(source: DataSourceParam, size = 14): SkFont | null {
  const tf = useCached(source, typefaces, loadTypeface);
  return useMemo(() => (tf ? fontOf(tf, size) : null), [tf, size]);
}
