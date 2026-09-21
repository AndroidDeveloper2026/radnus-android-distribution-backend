// Mobile app release info, used by GET /api/app/version.
//
// HOW TO RELEASE AN UPDATE
//   1. Publish the new build to the Play Store / App Store.
//   2. Set the env vars below in your .env.<NODE_ENV> file and restart the server.
//        ANDROID_LATEST_VERSION=1.3.0   -> users on older versions see an "Update Available" popup (can tap Later)
//        ANDROID_MIN_VERSION=1.2.0      -> users below this see "Update Required" (cannot dismiss)
//      (same for IOS_*). Leave MIN_VERSION alone unless the old version must stop working.
//
// Versions must match the app's versionName (Android) / CFBundleShortVersionString (iOS),
// e.g. "1.3.0".

const env = process.env;

module.exports = {
  android: {
    latestVersion: env.ANDROID_LATEST_VERSION || "1.0.0",
    minVersion: env.ANDROID_MIN_VERSION || "1.0.0",
    // e.g. https://play.google.com/store/apps/details?id=com.your.package
    storeUrl: env.ANDROID_STORE_URL || "",
  },
  ios: {
    latestVersion: env.IOS_LATEST_VERSION || "1.0.0",
    minVersion: env.IOS_MIN_VERSION || "1.0.0",
    // e.g. https://apps.apple.com/app/id1234567890
    storeUrl: env.IOS_STORE_URL || "",
  },
  message:
    env.APP_UPDATE_MESSAGE ||
    "A new version of the app is available with improvements and bug fixes. Please update to continue with the best experience.",
  forceMessage:
    env.APP_FORCE_UPDATE_MESSAGE ||
    "This version of the app is no longer supported. Please update to the latest version to continue.",
};
