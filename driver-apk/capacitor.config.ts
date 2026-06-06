import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.buxtaxi.driver',
  appName: 'BuxTaxi Водитель',
  webDir: 'www',
  server: {
    url: 'https://nil.taxi1313.ru/driver',
    cleartext: false,
    androidScheme: 'https',
    allowNavigation: ['nil.taxi1313.ru'],
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: '#1a1a2e',
      showSpinner: true,
      spinnerColor: '#f59e0b',
      androidSpinnerStyle: 'large',
      launchFadeOutDuration: 300,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#1a1a2e',
      overlaysWebView: false,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'body',
      resizeOnFullScreen: true,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#f59e0b',
      sound: 'order_alert.wav',
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#1a1a2e',
    buildOptions: {
      keystorePath: undefined,
      keystorePassword: undefined,
      keystoreAlias: undefined,
      keystoreAliasPassword: undefined,
      releaseType: 'APK',
    },
  },
};

export default config;
