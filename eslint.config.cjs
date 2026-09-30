const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

module.exports = [{
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
}, {
    files: ['src/**/*.ts'],
    languageOptions: {
        parser: tsParser,
        ecmaVersion: 2018,
        sourceType: 'module',
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
        ...js.configs.recommended.rules,
        ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
        ...tsPlugin.configs.recommended.rules,
        '@typescript-eslint/no-require-imports': 'off',
        // Keep the ES2018 build target; Error.cause requires ES2022 library types.
        'preserve-caught-error': 'off',
        '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
        quotes: ['warn', 'single'],
        indent: ['warn', 4, { SwitchCase: 1 }],
        'comma-dangle': ['warn', 'always-multiline'],
        eqeqeq: 'warn',
        curly: ['warn', 'all'],
        'brace-style': 'warn',
        'prefer-arrow-callback': 'warn',
        'max-len': ['warn', 160],
        'no-console': 'warn',
        'comma-spacing': 'error',
        'no-multi-spaces': ['warn', { ignoreEOLComments: true }],
        'no-trailing-spaces': 'warn',
        'lines-between-class-members': ['warn', 'always', { exceptAfterSingleLine: true }],
    },
}];
