# AquaLora Mobile – Quick Start Guide

## Overview

The **AquaLoRa Mobile App** is a React Native (Expo) client that connects directly to the AquaLoRa backend API. It is a **completely independent system** from the desktop application — both authenticate separately against the same backend and read data from the same PostgreSQL database.

**Architecture**:
- **Desktop app**: Works offline with local SQLite, syncs to backend when online
- **Mobile app**: Reads from backend API (no local database)
- **Backend API**: Single source of truth for all cloud data
- **Credentials**: Configured on backend; both apps use same credentials

## Prerequisites
- Node.js **≥ 20** (download from https://nodejs.org)
- **npm** or **yarn** (commands below use npm)
- **Expo CLI** (global install): `npm install -g expo-cli`
- Android Studio (for Android emulator) **OR** Expo Go app on a physical device
- **Backend must be running** — either locally (`http://localhost:8000`) or on Railway

## Folder structure
```
desktop_application/
│   ... (existing desktop code)
│
├─ mobile_app/               # Expo project (mobile UI)
│   ├─ package.json
│   ├─ app.json
│   ├─ src/
│   │   ├─ App.tsx
│   │   ├─ navigation/index.tsx
│   │   └─ screens/LoginScreen.tsx
│   └─ README.md   <-- you are reading this!
│
└─ mobile_auth_server/       # Tiny Express auth service
    ├─ package.json
    └─ src/
        └─ db.ts
        └─ server.js
```

## Setup & Run
### 1. Install dependencies for the auth server
```bash
cd desktop_application/mobile_auth_server
npm install
```
### 2. Start the auth server
```bash
npm start
# The server will listen on http://localhost:3001
```
You should see a log line like:
```
[auth] Server listening on http://localhost:3001
```
### 3. Install dependencies for the mobile app
```bash
cd ../mobile_app
npm install
```
### 4. Run the mobile app with Expo
```bash
npm run start   # opens the Expo dev tools in a browser
```
- On the Expo dev tools page click **Run on Android device/emulator** (or iOS) to launch the app.
- If you are using a physical device, scan the QR code with the **Expo Go** app.

### 5. Test the login flow
1. The app starts on the **Login** screen.
2. Enter the admin credentials (Admin / Admin123) and press **Login**.
3. On success, you are navigated to a placeholder Home screen.
4. Wrong credentials show an alert “Login failed”.

## Credentials & User Management

Credentials are configured on the backend API (in `.env` or Railway dashboard):

```env
ADMIN_USERNAME=Admin
ADMIN_PASSWORD=Admin123
JWT_SECRET=your-secret-key
```

Both desktop and mobile apps authenticate against these same backend credentials.

**Future**: When the backend supports per-user authentication, both apps will auto-support it.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Cannot reach backend"** | Verify backend is running, check `API_BASE_URL` in `config.ts` |
| **"Login failed" (401)** | Check credentials against backend config (default: Admin/Admin123) |
| **"Android emulator can't reach localhost"** | Use `http://10.0.2.2:8000` instead of `http://localhost:8000` |
| **CORS errors** | Backend should enable CORS for mobile client IP |
| **Token expired** | Implement token refresh in future iterations |

## Next Steps

1. **Dashboard readings**: Fetch from backend `/readings/latest`
2. **History view**: Fetch from backend `/readings/history` with time filters
3. **Alert display**: Once backend adds `/alerts/latest`, display alerts
4. **Persistent login**: Use Async Storage or Secure Store to save token
5. **Push notifications**: Set up Firebase Cloud Messaging (FCM) for alerts
6. **Real-time updates**: Implement WebSocket or polling for live readings

---

**Related docs**:
- [Backend/README.md](../Backend/README.md) — API setup & deployment
- [Main README.md](../README.md) — System architecture overview
