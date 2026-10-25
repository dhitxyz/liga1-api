# Liga 1 API for TV Home

Automatic JSON endpoint providing BRI Liga 1 Indonesia standings and match fixtures for TV Home Launcher.

## Raw JSON Endpoint
```
https://raw.githubusercontent.com/dhitxyz/liga1-api/main/data.json
```

## Features
- **Auto-Update**: GitHub Actions runs automatically every evening (18:00, 21:00, 23:00 WIB) after matches conclude.
- **Manual Trigger**: Can be updated on-demand via GitHub Actions `workflow_dispatch`.
- **Manual Edit**: `data.json` can also be directly edited in the GitHub web UI or mobile app if needed.
