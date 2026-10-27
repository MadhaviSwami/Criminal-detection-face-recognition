# AI-Based Face Recognition and Investigation System

> **⚠️ Educational Project Only** — Uses fictional identities or consenting participants. Not connected to any real criminal databases.

## Overview

A dark-themed web application for face detection and recognition, built with Python, Flask, OpenCV and MySQL. It detects faces in uploaded images or a live webcam feed, generates facial embeddings, and compares them against a database of identities.

## Tech Stack

| Component | Technology |
|---|---|
| Backend | Python + Flask |
| Face Detection | OpenCV DNN (YuNet) |
| Face Recognition | OpenCV DNN (SFace, 128-d embeddings) |
| Database | MySQL 8 (with connection pooling) |
| Frontend | HTML + CSS + JavaScript (SPA, webcam via `getUserMedia`) |

## Project Structure

```
Criminal Detection Using Face Recognition/
├── app.py                          # Flask application & API routes
├── export_database_sql.py          # Export the MySQL database to database/facevault.sql
├── requirements.txt                # Python dependencies
├── .env.example                    # Template for .env (MySQL connection settings)
├── .env                            # Your real settings (private, not committed)
├── README.md                       # This file
│
├── models/
│   ├── face_detection_yunet_2023mar.onnx    # YuNet face detector
│   └── face_recognition_sface_2021dec.onnx  # SFace face recognizer
│
├── services/
│   ├── __init__.py
│   ├── face_detection.py           # Face detection using YuNet
│   ├── face_recognition.py         # Embedding generation & matching (SFace)
│   └── database_service.py         # MySQL operations
│
├── database/
│   └── facevault.sql               # SQL export (created by export_database_sql.py, not committed)
│
├── templates/
│   └── index.html                  # Single-page application
│
└── static/
    ├── css/style.css               # Dark theme design system
    ├── js/main.js                  # SPA logic, live scan & API interactions
    ├── uploads/                    # Uploaded images (auto-created)
    ├── results/                    # Annotated images, face crops, live snapshots
    └── identity_photos/            # Identity reference photos
```

## Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Configure MySQL: copy .env.example to .env and set your password
#    DB_HOST=127.0.0.1
#    DB_PORT=3306
#    DB_USER=root
#    DB_PASSWORD=your_password
#    DB_NAME=facevault

# 3. Run the application (creates the database and tables on first run)
python app.py

# 4. Open in browser
# http://127.0.0.1:5000
```

By default the server only listens on this PC with debug mode off. Set `HOST=0.0.0.0` to allow other devices on your network, or `FLASK_DEBUG=1` for debug mode.

## Features

- **Dashboard** — Stats (identities, embeddings, scans, matches) and recent activity, with a **View** link for each scan's full details
- **Face Recognition** — Upload an image, detect faces, and find matches with similarity scores
- **Live Scan** — Real-time webcam recognition with face boxes, names and match %, plus an automatic **Best Match** snapshot (downloadable, saved to the logs when the camera stops)
- **Scan Details** — Snapshot/annotated image, matched person's name, code/alias, description and match %
- **Identity Management** — Add/delete identities, add extra photos to improve matching
- **Activity Logs** — Complete history of upload and live scans
- **Data Management** — Option to delete all stored facial data

## Database Backup / Export

The app stores its data in MySQL. To get a readable `.sql` copy:

```bash
python export_database_sql.py          # writes database/facevault.sql
```

To restore it on another machine:

```bash
mysql -u root -p < database/facevault.sql
```

The export is a snapshot; re-run the script after changes. It contains personal data and face embeddings, so keep it private.

## Important Notes

- This is an **educational computer vision project**
- Uses **fictional identities** or consenting participants only
- **Not connected** to any real criminal or law enforcement databases
- Face detection uses OpenCV's YuNet model (no C++ build tools required)
- Face recognition uses OpenCV's SFace model (128-d cosine similarity, match threshold 0.35)
