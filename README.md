# Liga 1 API & Live Scraper for TV Home

Automatic JSON endpoint and real-time live scraper providing BRI Liga 1 Indonesia standings and match fixtures for TV Home Launcher.

## Endpoints
- **GitHub Raw CDN:**
  ```
  https://raw.githubusercontent.com/dhitxyz/liga1-api/main/data.json
  ```
- **Pterodactyl / Local Server API:**
  ```
  http://<IP-SERVER>:<PORT>/data.json
  http://<IP-SERVER>:<PORT>/status
  ```

---

## Fitur Bot Node.js (`liga1.js`)
1. **Dynamic Interval Polling**:
   - **Mode Match (15:00 - 23:30 WIB):** Cek setiap **60 detik (1 menit)** agar skor gol langsung terupdate instan ke TV!
   - **Mode Santai:** Cek setiap 15 menit.
2. **Zero Dependencies**: Menggunakan native Node.js (`fetch`, `http`, `fs`). Tidak perlu `npm install` paket apa pun!
3. **Auto-Sync to GitHub (Opsional)**:
   - Jika `GITHUB_TOKEN` diisi di konfigurasi PM2 / Environment, bot akan otomatis meng-update file `data.json` di GitHub repo via REST API begitu ada perubahan skor.
   - TV Anda yang membaca `raw.githubusercontent.com` otomatis terupdate secara live.

---

## Panduan Setup di PM2 / Pterodactyl Panel
1. Di Pterodactyl, buat folder baru `liga1/`.
2. Upload 2 file ke dalam folder `liga1/`:
   - `liga1.js`
   - `data.json`
3. Tambahkan ke file `ecosystem.config.cjs`:
   ```javascript
   {
     name: 'liga1-bot',
     script: 'liga1.js',
     cwd: './liga1',
     instances: 1,
     autorestart: true,
     watch: false,
     max_memory_restart: '60M',
     restart_delay: 5000,
     env: {
       NODE_ENV: 'production',
       GITHUB_TOKEN: '', // Opsional: Token GitHub PAT
       GITHUB_REPO: 'dhitxyz/liga1-api'
     }
   }
   ```
4. Restart server via Console Pterodactyl.
