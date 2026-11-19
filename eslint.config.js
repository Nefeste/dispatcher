// из bukvitsa: eslint.config.js @ 29b981e — правило чистоты движка (ADR студии 0004); свой запрет импортов экрана
// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'dist-web/*', 'src/content/generated/*', 'src/map/generated/*'],
  },
  {
    // движок чистый: ни часов, ни случайности, ни экрана (AGENTS.md, docs/02-architecture.md §2)
    files: ['src/engine/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Время — аргументом (целые секунды смены).' },
        { object: 'Math', property: 'random', message: 'Случайность — из зерна смены.' },
      ],
      'no-restricted-syntax': ['error', { selector: "NewExpression[callee.name='Date']", message: 'Время — аргументом.' }],
      'no-restricted-imports': ['error', { patterns: ['react', 'react-*', 'expo*', '@shopify/*', '../ui/*', '../screens/*'] }],
    },
  },
]);
