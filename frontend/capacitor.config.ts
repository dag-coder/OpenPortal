import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.openportal.app',
  appName: 'OpenPortal',
  webDir: 'dist',
  server: {
    // In development, point to local API
    // In production, remove this and use the bundled app
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      backgroundColor: '#0a0a0b',
      showSpinner: false,
    },
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0a0a0b',
    },
    BiometricAuth: {
      androidTitle: 'OpenPortal',
      androidSubtitle: 'Authenticate to access your tools',
    },
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#0a0a0b',
  },
  android: {
    backgroundColor: '#0a0a0b',
    allowMixedContent: false,
  },
};

export default config;
