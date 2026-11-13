import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist', '**/target', '**/node_modules', '**/.next', '**/.source', '.claude', '.data'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { languageOptions: { globals: { ...globals.node } } },
  { files: ['apps/web/src/**'], languageOptions: { globals: { ...globals.browser } } },
)
