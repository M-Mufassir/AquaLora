# AquaLoRa Mobile App – Setup & Architecture

## Overview

The **AquaLoRa Mobile App** is a React Native (Expo) client that connects directly to the AquaLoRa backend API. It is a **completely independent system** from the desktop application — both authenticate separately against the same backend and read data from the same PostgreSQL database.

```
┌──────────────────────────┐           ┌──────────────────────────────┐
│   Desktop Application    │           │    Mobile Application        │
│   (Electron + React)     │           │    (React Native + Expo)     │
│                          │           │                              │
│ ├─ Local SQLite DB       │           │ ├─ Backend authentication    │
│ ├─ Offline monitoring    │           │ ├─ Read from Backend DB      │
│ └─ Sync to backend       │           │ └─ Remote access             │
└──────────────┬───────────┘           └──────────────┬───────────────┘
               │ (reads/writes)                       │ (reads only)
               │                                      │
               └──────────────┬───────────────────────┘
                              ▼
                    ┌──────────────────────────┐
                    │  Backend API (FastAPI)   │
                    │  PostgreSQL Database     │
                    │                          │
                    │ ├─ /auth/login           │
                    │ ├─ /readings/sync        │
                    │ ├─ /readings/latest      │
                    │ ├─ /readings/history     │
                    │ └─ /alerts/sync (future) │
                    └──────────────────────────┘
```

### Key Points

- **Desktop app**: Source of truth for local monitoring (SQLite), syncs to backend
- **Mobile app**: Remote reader, connects directly to backend API  
- **Backend API**: Single source of truth for cloud-stored readings (PostgreSQL)
- **Login credentials**: Configured once on the backend; both desktop and mobile use the same credentials
- **No local database on mobile**: Mobile fetches data on-demand from backend

---

## Prerequisites

- Node.js **≥ 20** (download from https://nodejs.org)
- **npm** or **yarn** (commands below use npm)
- **Expo CLI** (global install): `npm install -g expo-cli`
- Android Studio (for Android emulator) **OR** Expo Go app on a physical device
- **Backend must be running** — either locally (`http://localhost:8000`) or on Railway

---

## Setup & Run

### 1. Install mobile app dependencies

```bash
cd mobile_application
npm install
```

### 2. Configure backend URL

Edit `src/config.ts` and set the backend API endpoint:

```typescript
// For local development:
export const API_BASE_URL = 'http://localhost:8000'

// For production (Railway):
export const API_BASE_URL = 'https://aqualora.up.railway.app'
```

**Note for Android emulator**: If running on an Android emulator and backend is on localhost, use `http://10.0.2.2:8000` instead.

### 3. Start the mobile app

```bash
npm run start
# Opens Expo dev tools in browser
```

- Click **Run on Android device/emulator** (or iOS) from the Expo dev tools
- Or scan the QR code with **Expo Go** app on a physical device

### 4. Test the login flow

1. App opens on **Login** screen
2. Enter credentials (default: `Admin` / `Admin123`)
3. Press **Login**
4. On success: navigated to **Dashboard** screen
5. On failure: alert shows "Login failed"

---

## Features (Current & Planned)

| Feature | Status | Notes |
|---------|--------|-------|
| Login screen | ✅ Complete | Authenticates against `/auth/login` endpoint |
| Dashboard (current readings) | 🟡 In progress | Fetch from `/readings/latest` |
| History/charts | 🔴 Planned | Fetch from `/readings/history` |
| Alerts | 🔴 Planned | Read from `/alerts/latest` (after backend adds alerts table) |
| Push notifications (FCM) | 🔴 Planned | Requires Firebase setup + backend alert routing |
| Settings/user management | 🔴 Planned | Profile, password change, etc. |

---

## API Endpoints Used

The mobile app calls these backend endpoints:

| Endpoint | Method | Purpose | Auth |
|----------|--------|---------|------|
| `/auth/login` | `POST` | Get JWT token | ❌ No (credentials in body) |
| `/readings/latest` | `GET` | Current readings per node | ✅ Bearer token |
| `/readings/history` | `GET` | Time-window readings | ✅ Bearer token |
| `/health` | `GET` | Backend health check | ❌ No |

**Example login call**:
```typescript
const response = await axios.post(`${API_BASE_URL}/auth/login`, {
  username: 'Admin',
  password: 'Admin123'
});

const token = response.data.access_token;  // Use in future requests
```

**Example authorized call**:
```typescript
const readings = await axios.get(
  `${API_BASE_URL}/readings/latest`,
  {
    headers: { Authorization: `Bearer ${token}` }
  }
);
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **"Cannot reach backend"** | Verify backend is running, check `API_BASE_URL` in `config.ts`, test with `curl` |
| **"Login failed" (401)** | Check username/password against backend credentials (default: Admin/Admin123) |
| **"Android emulator can't reach localhost"** | Use `http://10.0.2.2:8000` instead of `http://localhost:8000` in `config.ts` |
| **CORS errors** | Backend should have CORS enabled for `http://localhost:3000` (Expo dev) and production URLs |
| **Token expired** | Mobile app should refresh token before each request (implement in a future iteration) |

---

## Architecture Notes

### Why no local database on mobile?

- **Simplicity**: No need to sync mobile SQLite ↔ backend
- **Freshness**: Always shows latest data from single source (backend PostgreSQL)
- **Scalability**: Mobile can work with any backend, not tied to desktop app

### Why authenticate separately?

- **Independence**: Mobile works even if desktop is offline
- **Scalability**: Multiple mobile users can connect simultaneously (not possible if they all read the same desktop SQLite)
- **Security**: Each app has its own session token; desktop token revocation doesn't affect mobile

### Future: User Accounts

Once the backend and desktop app support per-user authentication (not just hardcoded admin), the mobile app will automatically support it — just log in with your account credentials.

---

## Next Steps

1. **Get readings on mobile**: Implement dashboard screen to fetch from `/readings/latest`
2. **Add history view**: Charts + time-range filtering using `/readings/history`
3. **Alert display**: Once backend has alerts table, fetch from `/alerts/latest`
4. **Push notifications**: Set up Firebase Cloud Messaging (FCM) for threshold alerts
5. **Persistent login**: Use `@react-native-async-storage/async-storage` or `expo-secure-store` to save token

---

**Backend URL**: Check [Backend/README.md](../Backend/README.md) for setup and deployment instructions
