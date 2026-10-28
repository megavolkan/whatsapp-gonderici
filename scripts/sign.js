const { execSync } = require('child_process');
const path = require('path');

exports.default = async function(configuration) {
    const appPath = configuration.app;
    const entitlementsPath = path.join(__dirname, '..', 'entitlements.mac.plist');
    
    console.log(`--------------------------------------------------`);
    console.log(`Custom Sign: Ad-hoc signing: ${appPath}`);
    console.log(`Using entitlements: ${entitlementsPath}`);
    console.log(`--------------------------------------------------`);
    try {
        // Clear any quarantine or custom attributes that might cause verification errors
        execSync(`xattr -cr "${appPath}"`);
        
        // Apply ad-hoc deep code signature with Hardened Runtime options and entitlements
        execSync(`codesign --force --deep --sign - --options runtime --entitlements "${entitlementsPath}" "${appPath}"`);
        
        console.log(`Custom Sign: Successfully signed ${appPath}`);
    } catch (error) {
        console.error(`Custom Sign Error: Failed to sign ${appPath}`);
        console.error(error.stdout ? error.stdout.toString() : '');
        console.error(error.stderr ? error.stderr.toString() : error.message);
        throw error;
    }
};
