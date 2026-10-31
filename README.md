# Liga 1 API & Live Scraper for TV Home

Automatic JSON endpoint and real-time scraper providing BRI Liga 1 Indonesia standings and match fixtures for TV Home Launcher.

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

## Fitur Bot Pterodactyl (`bot.py` / `main.py`)
1. **Dynamic Interval Polling**:
   - **Mode Match (15:00 - 23:30 WIB):** Cek setiap **60 detik (1 menit)** agar skor gol langsung terupdate instan ke TV!
   - **Mode Santai:** Cek setiap 15 menit.
2. **Zero Dependencies**: Menggunakan Python Standard Library (`urllib`, `http.server`, `threading`, dll). Tidak perlu repot `pip install`.
3. **Auto-Sync to GitHub (Opsional)**:
   - Jika `GITHUB_TOKEN` diisi di panel, bot akan otomatis meng-update file `data.json` di GitHub repo via REST API begitu ada perubahan skor.
   - TV Anda yang membaca `raw.githubusercontent.com` otomatis terupdate tanpa perlu mengganti URL!

---

## Panduan Setup di Pterodactyl Panel
1. Di Pterodactyl, buat server baru menggunakan egg **Python** (versi 3.8 / 3.9 / 3.10 / 3.11 / 3.12 bebas).
2. Upload file berikut ke File Manager Pterodactyl:
   - `bot.py`
   - `main.py`
   - `scraper.py`
   - `data.json`
   - `requirements.txt`
3. Di menu **Startup**, pastikan Startup Command adalah:
   ```bash
   python main.py
   ```
4. (Opsional tapi direkomendasikan) Di tab **Startup** atau **Variables**:
   - Tambahkan Environment Variable:
     - `GITHUB_TOKEN`: *Personal Access Token GitHub Anda (permission: repo/contents:write)*
     - `GITHUB_REPO`: `dhitxyz/liga1-api`
5. Tekan **Start**! Server akan otomatis berjalan 24/7 dan melacak skor secara live.
