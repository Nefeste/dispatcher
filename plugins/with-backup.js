// из durak: plugins/with-backup.js @ 296f030 (оттуда — из nardy @ f0ee88a) — имена файлов правил свои
// (`dispatcher_…`), ссылки на свой ADR. Резервная копия Android (ADR 0010; путь к 1.0, ворота 5): станция, неделя,
// лучшие итоги, настройки и незаконченная смена переживают переустановку и переезжают на новый телефон вместе с
// остальными данными Android. В копию идёт только хранилище игры — база AsyncStorage `RKStorage` (с журналом). Профиля
// онлайна и покупок у игры нет: проверять, тот ли это телефон, нечего.
//
// Папки android/ в репозитории нет (CNG), поэтому правила пишутся здесь: `fullBackupContent` —
// для Android 11 и ниже, `dataExtractionRules` — для 12 и выше (облако и перенос на новый телефон).
// `tools:replace` — на случай, если библиотека объявит свои правила: в приложении действуют наши.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

/** База AsyncStorage (ReactDatabaseSupplier.DATABASE_NAME) и её журналы: с Android 9 — WAL. */
const FILES = ['RKStorage', 'RKStorage-journal', 'RKStorage-wal'];
const include = indent => FILES.map(f => `${indent}<include domain="database" path="${f}" />`).join('\n');

const LEGACY = `<?xml version="1.0" encoding="utf-8"?>
<!-- Сгенерировано plugins/with-backup.js: копия Android 11 и ниже — только хранилище игры. -->
<full-backup-content>
${include('  ')}
</full-backup-content>
`;

const RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Сгенерировано plugins/with-backup.js: копия в облако и перенос на новый телефон — только хранилище игры. -->
<data-extraction-rules>
  <cloud-backup>
${include('    ')}
  </cloud-backup>
  <device-transfer>
${include('    ')}
  </device-transfer>
</data-extraction-rules>
`;

const ATTRS = ['android:allowBackup', 'android:fullBackupContent', 'android:dataExtractionRules'];

function manifest(m) {
  m.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(m);
  app.$['android:allowBackup'] = 'true';
  app.$['android:fullBackupContent'] = '@xml/dispatcher_backup_rules';
  app.$['android:dataExtractionRules'] = '@xml/dispatcher_data_extraction_rules';
  const replace = new Set((app.$['tools:replace'] ?? '').split(',').map(s => s.trim()).filter(Boolean));
  for (const a of ATTRS) replace.add(a);
  app.$['tools:replace'] = [...replace].join(',');
  return m;
}

function writeRules(platformRoot) {
  const dir = path.join(platformRoot, 'app', 'src', 'main', 'res', 'xml');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'dispatcher_backup_rules.xml'), LEGACY);
  fs.writeFileSync(path.join(dir, 'dispatcher_data_extraction_rules.xml'), RULES);
}

const withBackup = config => {
  config = withAndroidManifest(config, c => {
    c.modResults = manifest(c.modResults);
    return c;
  });
  return withDangerousMod(config, ['android', async c => {
    writeRules(c.modRequest.platformProjectRoot);
    return c;
  }]);
};

module.exports = withBackup;
module.exports.transforms = { manifest, LEGACY, RULES, FILES };
