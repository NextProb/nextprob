const path = require('path');
const { notarize } = require('@electron/notarize');

const timestamp = () => new Date().toLocaleTimeString();

module.exports = async function notarizeApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;

  if (electronPlatformName !== 'darwin') {
    return;
  }

  if (process.env.SKIP_NOTARIZE === '1') {
    console.log('[notarize] SKIP_NOTARIZE=1 set, skipping notarization');
    return;
  }

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  const keychainProfile = process.env.APPLE_KEYCHAIN_PROFILE;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword =
    process.env.APPLE_ID_PASSWORD || process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  const appleApiKey = process.env.APPLE_API_KEY;
  const appleApiIssuer = process.env.APPLE_API_ISSUER;
  const appleApiKeyId = process.env.APPLE_API_KEY_ID;

  const hasKeychain = Boolean(keychainProfile);
  const hasAppleId = Boolean(appleId && appleIdPassword && teamId);
  const hasApiKey = Boolean(appleApiKey && appleApiIssuer && appleApiKeyId);

  if (!hasKeychain && !hasAppleId && !hasApiKey) {
    throw new Error(
      '[notarize] Missing notarization credentials. Provide one of:\n' +
        '- APPLE_KEYCHAIN_PROFILE\n' +
        '- APPLE_ID, APPLE_ID_PASSWORD (or APPLE_APP_SPECIFIC_PASSWORD), APPLE_TEAM_ID\n' +
        '- APPLE_API_KEY (absolute path), APPLE_API_KEY_ID, APPLE_API_ISSUER\n' +
        'Or set SKIP_NOTARIZE=1 to skip during local builds.'
    );
  }

  const options = { appPath };

  if (hasKeychain) {
    options.keychainProfile = keychainProfile;
  } else if (hasApiKey) {
    options.appleApiKey = appleApiKey;
    options.appleApiIssuer = appleApiIssuer;
    options.appleApiKeyId = appleApiKeyId;
  } else {
    options.appleId = appleId;
    options.appleIdPassword = appleIdPassword;
    options.teamId = teamId;
  }

  const { execSync } = require('child_process');
  const duOutput = execSync(`du -sm "${appPath}"`).toString().trim();
  const appDirSizeMB = parseInt(duOutput.split('\t')[0], 10);

  const startTime = Date.now();
  console.log(`\n========================================`);
  console.log(`[notarize] ${timestamp()} — Notarizing ${appPath} (~${appDirSizeMB} MB)`);
  console.log(`[notarize] This involves: zip → upload → Apple scan → staple`);
  console.log(`[notarize] Typically takes 5-15 minutes. Do NOT cancel — incomplete uploads leave orphaned submissions on Apple's servers.`);
  console.log(`========================================\n`);
  const progressInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    console.log(`[notarize] ${timestamp()} — Waiting for Apple... (${elapsed}s elapsed)`);
  }, 15000);
  try {
    await notarize(options);
  } finally {
    clearInterval(progressInterval);
  }
  const totalSec = Math.round((Date.now() - startTime) / 1000);
  console.log(`[notarize] ${timestamp()} — Notarization complete (${totalSec}s)`);
};
