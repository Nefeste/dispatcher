// Сохранить картинку в браузере (веб-сборка, сценарий в браузере): скачать файлом. Файловой системы Expo в вебе нет,
// а «Поделиться» браузера не отдаёт локальный файл (документация expo-sharing, SDK 57).
export async function saveImage(name: string, png: Uint8Array, _title: string): Promise<boolean> {
  try {
    const blob = new Blob([png as BlobPart], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return true;
  } catch {
    return false;
  }
}
