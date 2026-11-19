// Шрифт экранов рабочего места: Onest студии (брендбук; лицензия — assets/fonts/Onest-OFL.txt) как гарнитура Skia.
// Тот же файл, что у интерфейса (src/ui/fonts.ts). Один раз за запуск.
import { Onest_400Regular } from '@expo-google-fonts/onest/400Regular';
import { type SkTypeface, Skia } from '@shopify/react-native-skia';
import { Asset } from 'expo-asset';

let cached: Promise<SkTypeface> | undefined;

export function onestFace(): Promise<SkTypeface> {
  cached ??= (async () => {
    const asset = Asset.fromModule(Onest_400Regular);
    await asset.downloadAsync();
    const data = await Skia.Data.fromURI(asset.localUri ?? asset.uri);
    const face = Skia.Typeface.MakeFreeTypeFaceFromData(data);
    if (!face) throw new Error('font: cannot decode');
    return face;
  })();
  return cached;
}
