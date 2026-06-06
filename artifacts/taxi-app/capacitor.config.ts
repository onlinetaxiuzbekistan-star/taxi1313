import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'uz.taxi1313.driver',
  appName: '1313 Водитель',
  webDir: 'dist/public',
  server: {
    url: 'https://nil.taxi1313.ru/',
    cleartext: false,
    androidScheme: 'https',
    iosScheme: 'capacitor',
    allowNavigation: ['nil.taxi1313.ru', '*.taxi1313.ru'],
  },
  ios: {
    contentInset: 'automatic',
    backgroundColor: '#ffffff',
    scrollEnabled: true,
    allowsLinkPreview: false,
    limitsNavigationsToAppBoundDomains: false,
    webContentsDebuggingEnabled: false,
    handleApplicationNotifications: true,
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: '#ffffff',
    },
  },
};

export default config;
