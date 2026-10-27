"""
Export the FaceVault MySQL database to a readable .sql file.

Usage:  python export_database_sql.py [output_path]
Default output: database/facevault.sql
Uses the same .env settings as the app. The file contains CREATE TABLE and
INSERT statements and can be re-imported with:  mysql -u root -p < database/facevault.sql

Note: the export includes face embeddings and personal details - keep it private.
"""

import os
import sys
from datetime import datetime, date
from decimal import Decimal

from services import database_service as db

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUTPUT = os.path.join(BASE_DIR, 'database', 'facevault.sql')

# Parent tables first, so the file imports cleanly
TABLES = ['identities', 'face_embeddings', 'recognition_logs']


def sql_value(v):
    """Turn a Python value into a SQL literal."""
    if v is None:
        return 'NULL'
    if isinstance(v, (bytes, bytearray)):
        return '0x' + bytes(v).hex() if v else "''"
    if isinstance(v, bool):
        return '1' if v else '0'
    if isinstance(v, (int, float, Decimal)):
        return str(v)
    if isinstance(v, (datetime, date)):
        return f"'{v.strftime('%Y-%m-%d %H:%M:%S') if isinstance(v, datetime) else v.isoformat()}'"
    s = str(v).replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n').replace('\r', '\\r')
    return f"'{s}'"


def main():
    output = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUTPUT
    db.init_database()
    conn = db.get_connection()
    try:
        cur = conn.cursor()
        lines = [
            '-- ============================================================',
            '-- FaceVault AI - MySQL database export',
            f'-- Database: {db.DB_NAME}',
            f'-- Exported: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}',
            '-- Contains personal data and face embeddings. Keep private.',
            '-- ============================================================',
            '',
            'SET NAMES utf8mb4;',
            'SET FOREIGN_KEY_CHECKS = 0;',
            '',
            f'CREATE DATABASE IF NOT EXISTS `{db.DB_NAME}` '
            'CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;',
            f'USE `{db.DB_NAME}`;',
            '',
        ]

        for table in TABLES:
            cur.execute(f'SHOW CREATE TABLE `{table}`')
            create_sql = cur.fetchone()[1]

            cur.execute(f'SELECT * FROM `{table}` ORDER BY id')
            columns = [d[0] for d in cur.description]
            rows = cur.fetchall()

            lines += [
                '-- ------------------------------------------------------------',
                f'-- Table: {table}  ({len(rows)} row{"s" if len(rows) != 1 else ""})',
                '-- ------------------------------------------------------------',
                f'DROP TABLE IF EXISTS `{table}`;',
                create_sql + ';',
                '',
            ]
            if rows:
                col_list = ', '.join(f'`{c}`' for c in columns)
                lines.append(f'INSERT INTO `{table}` ({col_list}) VALUES')
                values = ['  (' + ', '.join(sql_value(v) for v in row) + ')' for row in rows]
                lines.append(',\n'.join(values) + ';')
                lines.append('')

        lines += ['SET FOREIGN_KEY_CHECKS = 1;', '']

        os.makedirs(os.path.dirname(output), exist_ok=True)
        with open(output, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))
    finally:
        conn.close()

    print(f'Exported {", ".join(TABLES)} to {output}')


if __name__ == '__main__':
    main()
