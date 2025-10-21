# Firebase Service Account Setup Guide

## What is a Service Account JSON?

A Firebase service account JSON file contains credentials that allow backend services to authenticate with Firebase. This is used for:
- Admin SDK operations
- Service-to-service authentication
- Local development with admin privileges
- Automated scripts/CI/CD pipelines

## Do You Need It?

✅ **YES** if you want to:
- Run admin scripts locally
- Set up automated backups
- Use the Admin SDK outside of Cloud Functions
- Perform bulk data operations

❌ **NO** if you only:
- Use Cloud Functions (they auto-authenticate)
- Let users authenticate via Firebase Auth
- Only use the web client

## How to Download Your Service Account JSON

1. Go to Firebase Console:
   https://console.firebase.google.com/project/expense-tracker-prod-df355/settings/serviceaccounts/adminsdk

2. Click **"Generate New Private Key"**

3. Save the file as `serviceAccountKey.json` in the project root

## ⚠️ Security Warning

**NEVER commit serviceAccountKey.json to Git!** It contains sensitive credentials.

Add to `.gitignore`:
```
serviceAccountKey.json
*.json
!package.json
!functions/package.json
!firebase.json
!.firebaserc
```

## Using in Scripts

```javascript
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://expense-tracker-prod-df355.firebaseio.com'
});

const db = admin.firestore();
// Now you can use Admin SDK with full privileges
```

## Current Status

✅ Cloud Functions work without service account (auto-authenticated)
✅ Firestore security rules are deployed and enforced
✅ Frontend uses Firebase Auth SDK (no service account needed)

Get the service account if you need to run admin scripts, otherwise your app is fully functional!
