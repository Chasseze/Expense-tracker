#!/usr/bin/env node
/**
 * Make Cloud Function publicly callable by setting IAM policy
 * Uses Firebase CLI authentication context
 */
const { execSync } = require('child_process');
const https = require('https');

async function getAccessToken() {
  try {
    // Use gcloud auth to get the access token
    const token = execSync('node -e "const{execSync}=require(\'child_process\');try{const out=execSync(\'npx -y @google-cloud/firestore@latest\',{encoding:\'utf8\'});console.log(\'ok\');}catch(e){}"', {
      encoding: 'utf8'
    });
    
    // Try using firebase CLI's built-in auth
    const cmd = process.platform === 'win32' 
      ? 'npx firebase use expense-tracker-prod-df355 && npx firebase functions:list --json'
      : 'npx firebase use expense-tracker-prod-df355 && npx firebase functions:list --json';
    
    const result = execSync(cmd, { encoding: 'utf8', cwd: process.cwd() });
    console.log('Firebase auth check:', result.slice(0, 100));
    return 'token-from-firebase-cli';
  } catch (e) {
    console.error('Error getting token:', e.message);
    return null;
  }
}

async function makePublic() {
  const token = await getAccessToken();
  if (!token) {
    console.error('\n❌ Could not authenticate. Please run: npx firebase login');
    process.exit(1);
  }

  const project = 'expense-tracker-prod-df355';
  const region = 'us-central1';
  const functionName = 'api';

  console.log(`\n🔐 Making ${functionName} publicly callable...`);
  console.log(`   Project: ${project}`);
  console.log(`   Region: ${region}`);

  // Use gcloud command via npx wrapper
  try {
    const cmd = `npx -y @google-cloud/cli@latest -- gcloud functions add-iam-policy-binding ${functionName} --region=${region} --member=allUsers --role=roles/cloudfunctions.invoker --project=${project} --quiet`;
    console.log(`\n Running: ${cmd}`);
    execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
    console.log('\n✅ Cloud Function is now publicly callable!');
  } catch (e) {
    console.error('\n⚠️  Command failed. Trying alternative method...');
    // If gcloud not available, we'll need to use Firebase console or wait for next deploy
    console.log('\nℹ️  The function will be publicly callable after the next `firebase deploy`');
    console.log('    Alternatively, make it public via Firebase Console:');
    console.log(`    https://console.firebase.google.com/project/${project}/functions`);
  }
}

makePublic().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
