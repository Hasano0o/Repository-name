/**
 * إعداد Jest لاختبارات الوحدات النقية في مشروع Bandly.
 *
 * النطاق:
 *  - اختبار ملفات TypeScript النقية (بدون React Native runtime)
 *  - لا يحاول تشغيل مكونات UI أو React Native modules
 *  - لا يتداخل مع expo-router أو Metro
 *
 * ملاحظات:
 *  - نستخدم ts-jest لأن مشروع Bandly مكتوب بالكامل بـ TypeScript strict.
 *  - testEnvironment = node لأن اختباراتنا لا تحتاج DOM.
 *  - moduleNameMapper يطابق alias @/* في tsconfig.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    // React Native/Expo global — declared here for Jest (Node.js).
    // Matches react-native/types/globals.d.ts:
    //   declare const __DEV__: boolean;
    __DEV__: true,
  },
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/?(*.)+(spec|test).ts',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.jest.json',
      },
    ],
  },
  collectCoverageFrom: [
    'src/router-discovery/**/*.ts',
    '!src/**/__tests__/**',
    '!src/**/*.test.ts',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/android/',
    '/ios/',
  ],
  clearMocks: true,
};
