import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.wasselni.monufia.app",
  appName: "وصلني المنوفية",
  webDir: "dist",

  androidScheme: "https",

  plugins: {
    Geolocation: {
      permissions: {
        location: "whenInUse"
      }
    }
  }
};

export default config;
