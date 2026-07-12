import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'jp.masanobu.kanken',
  appName: '漢検マスター',
  webDir: 'www',
  android: {
    allowMixedContent: true,
    backgroundColor: '#121216'
  },
  server: {
    androidScheme: 'https'
  }
};

export default config;
