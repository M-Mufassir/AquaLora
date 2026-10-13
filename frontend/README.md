# AquaLora Web Frontend

React + TypeScript + Tailwind CSS dashboard and control room for AquaLora.

---

## 1. Local Development

1. Start the backend first:
   ```bash
   cd backend
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

2. Start the frontend:
   ```bash
   cd frontend
   npm install
   npm run dev
   ```

By default, the web frontend calls `http://localhost:8000`. You can override this using `.env` or:
```bash
VITE_API_URL=http://localhost:8000 npm run dev
```

---

## 2. Deploying to Vercel

1. Push your repository to GitHub.
2. In the [Vercel Dashboard](https://vercel.com/new), click **Add New...** -> **Project**.
3. Import your GitHub repository (`AquaLora`).
4. In the project settings:
   - **Root Directory**: Select `frontend` (or click Edit and select `frontend`).
   - **Framework Preset**: Vite
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Under **Environment Variables**, add:
   - `VITE_API_URL`: Your Azure Backend API URL (e.g., `https://aqualora-api.azurewebsites.net`)
6. Click **Deploy**. Vercel will build and assign you a free HTTPS domain (e.g., `https://aqualora.vercel.app`).
