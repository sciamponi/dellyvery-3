import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
const isProdBuild = process.env.NODE_ENV === 'production';

export default defineConfig({
  plugins: [
    base44({
      // Support for legacy code that imports the base44 SDK with @/integrations, @/entities, etc.
      // can be removed if the code has been updated to use the new SDK imports from @base44/sdk
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      // Notificadores/trackers do editor Base44: ativos no dev, desligados na
      // build standalone (fora do editor eles chamam /api inexistente e quebram o render).
      hmrNotifier: !isProdBuild,
      navigationNotifier: !isProdBuild,
      analyticsTracker: !isProdBuild,
      visualEditAgent: !isProdBuild
    }),
    react(),
  ]
});
