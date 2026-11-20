// Сохранить картинку для себя (снимок смены, спецификация прототипа, §5): на телефоне — файл в кэше приложения и
// системное «Поделиться» (expo-sharing): оттуда — в галерею, в мессенджер, куда угодно, без разрешений самой игре.
// API — expo-file-system (File, Paths) и expo-sharing по документации SDK 57. Веб — src/ui/saveImage.web.ts.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** `false` — не вышло (нет места, нет «Поделиться»): игра идёт дальше. */
export async function saveImage(name: string, png: Uint8Array, title: string): Promise<boolean> {
  try {
    const file = new File(Paths.cache, name);
    if (file.exists) file.delete();
    file.create();
    file.write(png);
    if (!(await Sharing.isAvailableAsync())) return false;
    await Sharing.shareAsync(file.uri, { mimeType: 'image/png', dialogTitle: title });
    return true;
  } catch {
    return false;
  }
}
