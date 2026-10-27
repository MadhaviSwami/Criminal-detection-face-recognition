"""
Database Service (MySQL)
Handles all MySQL operations for storing identities, face embeddings, and recognition logs.

Connection settings come from environment variables (or a .env file in the project root):
    DB_HOST (default 127.0.0.1), DB_PORT (default 3306),
    DB_USER (default root), DB_PASSWORD, DB_NAME (default facevault)
"""

import os
import json
import logging

import threading

import numpy as np
import mysql.connector
from mysql.connector import pooling
from mysql.connector.errors import PoolError
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(BASE_DIR, '.env'))

DB_CONFIG = {
    'host': os.environ.get('DB_HOST', '127.0.0.1'),
    'port': int(os.environ.get('DB_PORT', 3306)),
    'user': os.environ.get('DB_USER', 'root'),
    'password': os.environ.get('DB_PASSWORD', ''),
}
DB_NAME = os.environ.get('DB_NAME', 'facevault')


POOL_SIZE = 10
_pool = None
_pool_lock = threading.Lock()


def get_connection():
    """
    Get a connection to the app's MySQL database.
    Connections come from a reusable pool, because opening a new MySQL
    connection takes ~200 ms (too slow for live webcam frames).
    Calling .close() on the result returns it to the pool.
    """
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = pooling.MySQLConnectionPool(
                    pool_name='facevault', pool_size=POOL_SIZE, database=DB_NAME, **DB_CONFIG
                )
    try:
        return _pool.get_connection()
    except PoolError:
        # All pooled connections busy: fall back to a one-off connection
        return mysql.connector.connect(database=DB_NAME, **DB_CONFIG)


def _query(sql, params=(), fetch=None):
    """
    Run one SQL statement.
    fetch: None (write, returns lastrowid), 'one' (dict or None), 'all' (list of dicts).
    """
    conn = get_connection()
    try:
        cursor = conn.cursor(dictionary=True)
        cursor.execute(sql, params)
        if fetch == 'one':
            return cursor.fetchone()
        if fetch == 'all':
            return cursor.fetchall()
        conn.commit()
        return cursor.lastrowid
    finally:
        conn.close()


def _format_dates(row):
    """Convert datetime columns to 'YYYY-MM-DD HH:MM:SS' strings for the frontend."""
    for key in ('created_at', 'updated_at'):
        if row.get(key) is not None and not isinstance(row[key], str):
            row[key] = row[key].strftime('%Y-%m-%d %H:%M:%S')
    return row


def init_database():
    """Create the database and tables if they don't exist yet."""
    conn = mysql.connector.connect(**DB_CONFIG)
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"CREATE DATABASE IF NOT EXISTS `{DB_NAME}` "
            "CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
        )
        cursor.execute(f"USE `{DB_NAME}`")

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS identities (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                alias VARCHAR(255) NOT NULL DEFAULT '',
                description TEXT,
                photo_path VARCHAR(512) NOT NULL DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS face_embeddings (
                id INT AUTO_INCREMENT PRIMARY KEY,
                identity_id INT NOT NULL,
                embedding BLOB NOT NULL,
                face_bbox VARCHAR(255) NOT NULL DEFAULT '',
                confidence FLOAT NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (identity_id) REFERENCES identities(id) ON DELETE CASCADE
            ) ENGINE=InnoDB
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS recognition_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                uploaded_image VARCHAR(512) NOT NULL,
                faces_detected INT NOT NULL DEFAULT 0,
                matches_found INT NOT NULL DEFAULT 0,
                results_json MEDIUMTEXT,
                scan_type VARCHAR(10) NOT NULL DEFAULT 'upload',
                annotated_image VARCHAR(512) NOT NULL DEFAULT '',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB
        ''')

        # Upgrade older tables that were created before these columns existed
        new_columns = {
            'scan_type': "VARCHAR(10) NOT NULL DEFAULT 'upload' AFTER results_json",
            'annotated_image': "VARCHAR(512) NOT NULL DEFAULT '' AFTER scan_type",
        }
        for col, definition in new_columns.items():
            cursor.execute(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = %s AND TABLE_NAME = 'recognition_logs' AND COLUMN_NAME = %s",
                (DB_NAME, col)
            )
            if cursor.fetchone()[0] == 0:
                cursor.execute(f"ALTER TABLE recognition_logs ADD COLUMN {col} {definition}")
                logger.info(f"Added column recognition_logs.{col}")

        conn.commit()
    finally:
        conn.close()
    logger.info(f"MySQL database '{DB_NAME}' ready on {DB_CONFIG['host']}:{DB_CONFIG['port']}.")


# ── Identity CRUD ──────────────────────────────────────────────────

def add_identity(name, alias='', description='', photo_path=''):
    """Add a new identity record. Returns the new identity's ID."""
    identity_id = _query(
        'INSERT INTO identities (name, alias, description, photo_path) VALUES (%s, %s, %s, %s)',
        (name, alias or '', description or '', photo_path or '')
    )
    logger.info(f"Added identity: {name} (ID: {identity_id})")
    return identity_id


def update_identity(identity_id, **kwargs):
    """Update an existing identity. Pass keyword args for fields to update."""
    allowed = {'name', 'alias', 'description', 'photo_path'}
    updates = {k: v for k, v in kwargs.items() if k in allowed and v is not None}
    if not updates:
        return

    set_clause = ', '.join(f'{k} = %s' for k in updates)
    _query(f'UPDATE identities SET {set_clause} WHERE id = %s',
           list(updates.values()) + [identity_id])


def delete_identity(identity_id):
    """Delete an identity; its embeddings are removed automatically (ON DELETE CASCADE)."""
    _query('DELETE FROM identities WHERE id = %s', (identity_id,))
    logger.info(f"Deleted identity ID: {identity_id}")


def get_all_identities():
    """Get all identities with their embedding count."""
    rows = _query('''
        SELECT i.*, COUNT(fe.id) AS embedding_count
        FROM identities i
        LEFT JOIN face_embeddings fe ON i.id = fe.identity_id
        GROUP BY i.id
        ORDER BY i.created_at DESC, i.id DESC
    ''', fetch='all')
    return [_format_dates(r) for r in rows]


def get_identity(identity_id):
    """Get a single identity by ID."""
    row = _query('SELECT * FROM identities WHERE id = %s', (identity_id,), fetch='one')
    return _format_dates(row) if row else None


# ── Embeddings ─────────────────────────────────────────────────────

def store_embedding(identity_id, embedding, face_bbox='', confidence=0.0):
    """Store a face embedding (numpy array → BLOB) for a given identity."""
    _query(
        'INSERT INTO face_embeddings (identity_id, embedding, face_bbox, confidence) VALUES (%s, %s, %s, %s)',
        (identity_id, embedding.astype(np.float32).tobytes(), face_bbox, float(confidence))
    )


def get_all_embeddings():
    """Retrieve all embeddings with associated identity info for matching."""
    rows = _query('''
        SELECT fe.id, fe.identity_id, fe.embedding, fe.confidence,
               i.name, i.alias, i.description, i.photo_path
        FROM face_embeddings fe
        JOIN identities i ON fe.identity_id = i.id
    ''', fetch='all')
    for r in rows:
        r['embedding'] = np.frombuffer(bytes(r['embedding']), dtype=np.float32)
    return rows


def delete_embeddings_for_identity(identity_id):
    """Delete all embeddings for a specific identity."""
    _query('DELETE FROM face_embeddings WHERE identity_id = %s', (identity_id,))


# ── Recognition Logs ───────────────────────────────────────────────

def log_recognition(uploaded_image, faces_detected, matches_found, results,
                    scan_type='upload', annotated_image=''):
    """Log a recognition scan event. scan_type is 'upload' or 'live'. Returns the log ID."""
    return _query(
        'INSERT INTO recognition_logs '
        '(uploaded_image, faces_detected, matches_found, results_json, scan_type, annotated_image) '
        'VALUES (%s, %s, %s, %s, %s, %s)',
        (uploaded_image, int(faces_detected), int(matches_found), json.dumps(results),
         scan_type, annotated_image or '')
    )


def get_recognition_log(log_id):
    """Get one recognition log with its results parsed from JSON."""
    row = _query('SELECT * FROM recognition_logs WHERE id = %s', (log_id,), fetch='one')
    if not row:
        return None
    row = _format_dates(row)
    try:
        row['results'] = json.loads(row.pop('results_json') or '[]')
    except ValueError:
        row['results'] = []
    return row


def find_identity_by_name(name):
    """Find the newest identity with this exact name (used for older logs that only stored names)."""
    row = _query('SELECT * FROM identities WHERE name = %s ORDER BY id DESC LIMIT 1', (name,), fetch='one')
    return _format_dates(row) if row else None


def get_recognition_logs(limit=50):
    """Get recent recognition logs."""
    rows = _query('SELECT * FROM recognition_logs ORDER BY created_at DESC, id DESC LIMIT %s',
                  (int(limit),), fetch='all')
    return [_format_dates(r) for r in rows]


# ── Statistics ─────────────────────────────────────────────────────

def get_stats():
    """Get dashboard statistics."""
    row = _query('''
        SELECT
            (SELECT COUNT(*) FROM identities) AS total_identities,
            (SELECT COUNT(*) FROM face_embeddings) AS total_embeddings,
            (SELECT COUNT(*) FROM recognition_logs) AS total_scans,
            (SELECT COALESCE(SUM(matches_found), 0) FROM recognition_logs) AS total_matches
    ''', fetch='one')
    # MySQL returns SUM() as Decimal; the frontend needs plain numbers
    return {k: int(v) for k, v in row.items()}


# ── Data Cleanup ───────────────────────────────────────────────────

def delete_all_data():
    """Purge all identities, embeddings, and logs."""
    conn = get_connection()
    try:
        cursor = conn.cursor()
        cursor.execute('DELETE FROM face_embeddings')
        cursor.execute('DELETE FROM recognition_logs')
        cursor.execute('DELETE FROM identities')
        conn.commit()
    finally:
        conn.close()
    logger.info("All data purged from database.")
