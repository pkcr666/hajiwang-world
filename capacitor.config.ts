import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hajiwang.world',
  appName: '哈基汪世界',
  webDir: 'dist',
  bundledWebRuntime: false,
  android: {
    backgroundColor: '#1a1a2e',
  },
};

export default config;
