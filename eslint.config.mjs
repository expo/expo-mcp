import { defineConfig } from 'eslint/config';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const baseConfig = require('eslint-config-universe/flat/node');

export default defineConfig([
  {
    extends: baseConfig,
    rules: {
      'sort-imports': [
        'error',
        {
          ignoreDeclarationSort: true,
          ignoreMemberSort: false,
        },
      ],
    },
  },
]);
