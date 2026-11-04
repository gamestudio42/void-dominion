import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const FORBIDDEN_MATH = ['random', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'exp', 'log', 'pow', 'hypot'];

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'test-results/**', 'playwright-report/**', '.gs42/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/kernel/src/**/*.ts', 'packages/simulation/src/**/*.ts', 'packages/content/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error',
        { name: 'Date', message: 'Wall clock is forbidden in the simulation.' },
        { name: 'performance', message: 'Wall clock is forbidden in the simulation.' },
        { name: 'window', message: 'No DOM in the simulation.' },
        { name: 'document', message: 'No DOM in the simulation.' },
        { name: 'setTimeout', message: 'Use simulation ticks.' },
        { name: 'setInterval', message: 'Use simulation ticks.' },
      ],
      'no-restricted-properties': ['error',
        ...FORBIDDEN_MATH.map((property) => ({
          object: 'Math',
          property,
          message: 'Use the kernel RNG. Math transcendental functions are not bit-identical across engines.',
        })),
      ],
    },
  },
);
