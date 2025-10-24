import { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.positive.checkin',
  appName: '正能量打卡',
  webDir: 'dist',
  server: { androidScheme: 'https' }
};
export default config;