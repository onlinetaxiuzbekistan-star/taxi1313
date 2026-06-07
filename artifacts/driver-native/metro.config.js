// Metro config for the Taxi 1313 native driver app.
// NativeWind transforms the CSS-driven design tokens (global.css) into RN styles.
//
// The API client (lib/api-client-react, already RN-ready) is vendored in-tree at
// src/lib/api-client to keep Metro resolution simple and the build hermetic.
// Re-sync it from the monorepo source with ./scripts-sync-api-client.sh whenever
// the OpenAPI client is regenerated.
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: "./global.css" });
